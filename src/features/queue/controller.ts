// Playlist mode, isolated side (design §24): decide whether to take over Add
// to queue, add to the chosen list, keep the top bar button and the playlist
// panel in step with the list whoever edits it (§24.8), and after a video from
// the list is watched, move on to the next one and remove it. The entry
// playing may also be removed while it plays (Clear all, Remove watched, a
// drag out of the panel: §47, §48); it plays on, then what came after it.

import { t } from '@/core/i18n';
import { notify } from '@/core/notify';
import type { Toggleable } from '@/core/dom';
import type { Logger } from '@/core/log';
import type { Dropped, PlayerEvent } from './bridge';
import {
  addActions, countWith, decideTakeover, DEFAULT_PROFILE, leftCountsAsWatched, listSignature, meetsExpect, mergeExpect, nextAfter, nextAfterRemoved,
  notInList, removedPlaying, type Expect, type ListEdit, type ListItem, type ListSnapshot, type QueueMode, type QueueProfile, type Takeover,
} from './core';
import { PROTOCOL_ERROR_KEY } from './keys';
import type { PlayButton } from './play-button';
import { getProfile, onProfileChanged, updateProfile, type Identity } from './profiles';
import type { Playing, Rpc } from './rpc';

/** When the tab comes back, re-read the list (edits elsewhere) at most this often. */
const RECHECK_MS = 5_000;
/** Edits closer together than this are handled as one (clear all sends one per 100). */
const EDIT_BATCH_MS = 300;
/** Removals can take a few seconds to show in reads (§21.4). */
const READ_WAITS = [0, 1500, 3000, 5000];
/** A list reads as missing for its first second or two (findings F16): read again before believing it is gone. */
const GONE_WAITS = [1500, 3000];
/** How long our own knowledge of an edit outranks what reads say (they lag behind). */
const OVERLAY_MS = 30_000;

type Plan = { videoId: string; watched?: ListItem; next?: ListItem };

export class QueueController {
  me: Identity | undefined;
  profile: QueueProfile = DEFAULT_PROFILE;
  decision: Takeover = 'native';
  private editable: boolean | undefined;
  private items: ListItem[] = [];
  private lastRead = 0;
  private protocolError = false;
  private hinted = false;
  private gen = 0;
  private unsubProfile: (() => void) | undefined;
  private modeToast: QueueMode | undefined;
  private pending: Plan | undefined;
  /** The list a removal is armed for (unload, §28.1), if any. */
  private armedFor: string | undefined;
  private toolsOn = false;
  /** The video reloaded inside the list by the fallback attach (§24.2), until it ends. */
  private attached: string | undefined;
  /** The entry playing was removed (§47, §48): its videoId, and the entries up to it as the list was. */
  private removedHere: { videoId: string; upTo: string[] } | undefined;
  private edits: { expect: Expect; timer: ReturnType<typeof setTimeout> } | undefined;
  /** The latest look at the list, ours or the panel's; the count is taken from it (§24.8). */
  private snap: ListSnapshot | undefined;
  /** Edits seen lately, applied on top of any snapshot until reads surely show them. */
  private overlay: { expect: Expect; until: number } | undefined;
  private syncGen = 0;
  private onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (this.modeToast) this.showModeToast(this.modeToast);
    if (this.decision === 'take' && Date.now() - this.lastRead > RECHECK_MS) void this.recheck();
  };

  constructor(
    private rpc: Rpc,
    private log: Logger,
    private featureOn: () => boolean,
    private tools: Toggleable,
    private button: PlayButton,
  ) {
    document.addEventListener('visibilitychange', this.onVisible);
  }

  /** Stop listening to the page and to settings. */
  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    this.unsubProfile?.();
    this.unsubProfile = undefined;
    if (this.edits) clearTimeout(this.edits.timer);
    this.edits = undefined;
  }

  get listId(): string | undefined {
    return this.profile.listId;
  }

  listName(): string {
    const p = this.profile;
    return p.listName || (p.listId === 'WL' ? t('queue.watchLater') : p.listId ?? '');
  }

  /** Read identity, settings and the list again, then apply. */
  async refresh(): Promise<void> {
    const gen = ++this.gen;
    const me = await this.rpc.identity();
    if (gen !== this.gen) return;
    if (me.key !== this.me?.key) {
      this.unsubProfile?.();
      this.unsubProfile = me.key ? onProfileChanged(me.key, (p) => this.onProfile(p)) : undefined;
    }
    this.me = me;
    const on = this.featureOn() && me.loggedIn;
    if (on !== this.toolsOn) {
      this.toolsOn = on;
      if (on) this.tools.enable();
      else this.tools.disable();
    }
    const profile = me.key ? await getProfile(me.key) : DEFAULT_PROFILE;
    if (gen !== this.gen) return;
    if (profile.listId !== this.profile.listId) {
      this.snap = undefined;
      this.overlay = undefined;
    }
    this.profile = profile;
    this.editable = undefined;
    if (on && profile.mode === 'playlist' && profile.listId) await this.checkList();
    if (gen !== this.gen) return;
    await this.apply();
  }

  /** Is the chosen list there, and can this identity edit it (§24.1, §24.5)? */
  private async checkList(): Promise<void> {
    const id = this.profile.listId!;
    try {
      const lists = await this.rpc.editablePlaylists();
      if (!lists.length) {
        // Watch Later is always there: an empty answer means the shape changed.
        await this.setProtocolError('playlist/get_add_to_playlist listed no playlists');
        return;
      }
      const mine = lists.find((l) => l.id === id);
      if (mine) {
        this.editable = true;
        if (mine.title && mine.title !== this.profile.listName && this.me?.key) {
          this.profile = await updateProfile(this.me.key, (p) => { p.listName = mine.title; });
        }
        await this.readItems();
        return;
      }
      const data = await this.rpc.readPlaylist(id);
      if (data.exists) {
        this.editable = false;
        return;
      }
      const now = await this.goneForSure(id);
      if (now === 'gone') await this.listGone(id);
      else if (now === 'there') return await this.checkList();
      else this.editable = undefined;
    } catch (e) {
      this.log.warn('could not check the queue playlist', e);
      this.editable = undefined;
    }
  }

  private async setProtocolError(detail: string): Promise<void> {
    this.protocolError = true;
    this.log.error(`protocol error, playlist mode paused on this page: ${detail}`);
    await browser.storage.local.set({ [PROTOCOL_ERROR_KEY]: { time: Date.now(), detail } });
  }

  /**
   * Reads say `id` does not exist: read again a little later. 'gone' if they
   * keep saying so, 'there' once they show it, 'unknown' if a read fails.
   */
  private async goneForSure(id: string): Promise<'gone' | 'there' | 'unknown'> {
    for (const wait of GONE_WAITS) {
      await new Promise((r) => setTimeout(r, wait));
      const d = await this.rpc.readPlaylist(id).catch(() => undefined);
      if (!d) return 'unknown';
      if (d.exists) return 'there';
    }
    return 'gone';
  }

  /**
   * List `id` was deleted elsewhere: forget it for this identity (§24.5).
   * False, and nothing cleared, if another list was chosen while `id` was being
   * checked: the check takes seconds, and the choice is read again at the end.
   */
  private async listGone(id: string): Promise<boolean> {
    if (!this.me?.key) return false;
    let cleared = false;
    this.profile = await updateProfile(this.me.key, (p) => {
      if (p.listId !== id) return;
      delete p.listId;
      delete p.listName;
      cleared = true;
    });
    if (!cleared) return false;
    this.log.info(`queue playlist ${id} no longer exists; cleared the choice`);
    this.editable = undefined;
    this.items = [];
    this.snap = undefined;
    this.overlay = undefined;
    return true;
  }

  private async readItems(): Promise<ListItem[]> {
    const listId = this.profile.listId!;
    const data = await this.rpc.readPlaylist(listId);
    if (!data.exists) {
      await this.noticeGone(listId);
      return this.items;
    }
    this.took(data.items);
    return this.items;
  }

  /** A read says the list is not there (deleted elsewhere): check, then forget it and say so (§24.5, findings F5). */
  private async noticeGone(listId: string): Promise<void> {
    if (await this.goneForSure(listId) !== 'gone') return;
    const name = this.listName();
    if (!await this.listGone(listId)) return;
    await this.apply();
    notify(t('queue.listGone', { name }), { error: true, action: { label: t('queue.toSettings'), run: openSettings } });
  }

  /** A fresh read of the list. */
  private took(items: ListItem[]): void {
    this.items = items;
    this.lastRead = Date.now();
    this.takeSnapshot({ rows: items, total: items.length, at: this.lastRead });
  }

  /** The newest snapshot wins; an older one arriving late is ignored. */
  private takeSnapshot(snap: ListSnapshot): void {
    if (this.snap && snap.at < this.snap.at) return;
    this.snap = snap;
  }

  /** The page put a list in the playlist panel: if it is ours, the count follows it. */
  onPanel(playlistId: string, snap: ListSnapshot): void {
    if (this.decision !== 'take' || playlistId !== this.listId) return;
    this.takeSnapshot(snap);
    this.showButton();
  }

  private activeOverlay(): Expect | undefined {
    if (this.overlay && Date.now() > this.overlay.until) this.overlay = undefined;
    return this.overlay?.expect;
  }

  /** Back to this tab: if the list changed elsewhere (another tab, the phone), catch up. */
  private async recheck(): Promise<void> {
    const listId = this.listId;
    if (!listId) return;
    try {
      const before = listSignature(this.items);
      await this.readItems();
      this.showButton();
      if (listSignature(this.items) !== before) await this.rpc.syncList(listId, undefined, false);
    } catch (e) {
      this.log.debug(`recheck failed: ${String(e)}`);
    }
  }

  // ---------- §24.8 keep the UI in step ----------

  /** Any successful edit of a list, by the page or by us. */
  onEdited(e: ListEdit): void {
    const listId = this.listId;
    if (e.playlistId !== listId) return;
    // The count changes now; reads and the panel follow.
    this.remember(e);
    // Not taking over: only remember it, for a switch back while reads lag (findings F4).
    if (this.decision !== 'take') return;
    this.showButton();
    const expect = mergeExpect(this.edits?.expect, e);
    if (this.edits) clearTimeout(this.edits.timer);
    this.edits = {
      expect,
      timer: setTimeout(() => {
        this.edits = undefined;
        void this.afterEdit(listId, expect);
      }, EDIT_BATCH_MS),
    };
  }

  /** Put an edit in the overlay, on top of what reads say, for a while. */
  private remember(e: ListEdit): void {
    const prev = this.activeOverlay();
    // Added a moment ago and now removed by entry: no longer expected.
    const removed = new Set((e.gone ?? []).map((sid) => [...this.items, ...(this.snap?.rows ?? [])].find((i) => i.setVideoId === sid)?.videoId).filter(Boolean));
    const kept = prev ? { ...prev, has: (prev.has ?? []).filter((v) => !removed.has(v)) } : undefined;
    this.overlay = { expect: mergeExpect(kept, e), until: Date.now() + OVERLAY_MS };
  }

  /** Top bar count, and the panel if this list is playing, once reads show the edit. */
  private async afterEdit(listId: string, expect: Expect): Promise<void> {
    const gen = ++this.syncGen;
    await Promise.all([
      this.recountUntil(expect, gen),
      this.rpc.syncList(listId, expect, false).catch((err) => this.log.debug(`sync panel: ${String(err)}`)),
    ]);
  }

  private async recountUntil(expect: Expect, gen: number): Promise<void> {
    try {
      for (const wait of READ_WAITS) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        if (gen !== this.syncGen) return; // a newer edit took over
        await this.readItems();
        if (meetsExpect(this.items, expect)) break;
      }
      if (gen === this.syncGen) this.showButton();
    } catch (e) {
      this.log.debug(`recount failed: ${String(e)}`);
    }
  }

  private showButton(): void {
    if (this.decision === 'take') this.button.show(this.listName(), countWith(this.snap, this.activeOverlay()) ?? this.items.length);
    else this.button.hide();
  }

  private async apply(): Promise<void> {
    const before = this.decision;
    this.decision = decideTakeover({
      featureOn: this.featureOn(),
      profile: this.profile,
      loggedIn: !!this.me?.loggedIn,
      editable: this.editable,
      protocolError: this.protocolError,
    });
    if (this.decision !== 'take') {
      // Not ours any more: forget the plan and what we knew of the list (findings F1, F3).
      await this.dropPlan();
      this.removedHere = undefined;
      if (before === 'take') {
        this.snap = undefined;
        this.overlay = undefined;
      }
    }
    await this.rpc.setTakeover({ decision: this.decision, label: t('queue.addTo', { name: this.listName() }), listId: this.decision === 'take' ? this.listId : undefined });
    this.showButton();
  }

  /** Forget the next-entry plan and disarm the removal armed for closing the tab. */
  private async dropPlan(): Promise<void> {
    this.pending = undefined;
    if (!this.armedFor) return;
    this.armedFor = undefined;
    await this.rpc.disarm().catch((e) => this.log.debug(`disarm: ${String(e)}`));
  }

  private onProfile(p: QueueProfile): void {
    const old = this.profile;
    if (old.mode !== p.mode) this.showModeToast(p.mode);
    if (old.listId !== p.listId) {
      // Another list: nothing known of the old one counts for it (findings F1, F2).
      this.snap = undefined;
      this.overlay = undefined;
      this.removedHere = undefined;
      void this.dropPlan();
    }
    this.profile = p;
    if (old.mode === p.mode && old.listId === p.listId) void this.apply(); // name or remove-after-playing only
    else void this.refresh();
  }

  /** A tab open while the mode changed keeps its own queue until reloaded (§24.6). */
  private showModeToast(mode: QueueMode): void {
    if (document.visibilityState !== 'visible') {
      this.modeToast = mode;
      return;
    }
    this.modeToast = undefined;
    notify(t(mode === 'playlist' ? 'queue.switchedPlaylist' : 'queue.switchedNative'), { action: { label: t('queue.reload'), run: () => location.reload() } });
  }

  // ---------- §24.2 add ----------

  async onAdd(videoIds: string[]): Promise<void> {
    const listId = this.listId;
    if (this.decision !== 'take' || !listId) return;
    const name = this.listName();
    const gone = async () => {
      if (!await this.listGone(listId)) return;
      await this.apply();
      notify(t('queue.listGone', { name }), { error: true, action: { label: t('queue.toSettings'), run: openSettings } });
    };
    const view = { label: t('queue.view'), run: () => void this.rpc.openPlaylist(listId) };
    try {
      // The server ignores DEDUPE_OPTION_SKIP and appends a duplicate, so check first.
      const data = await this.rpc.readPlaylist(listId);
      if (!data.exists) {
        const now = await this.goneForSure(listId);
        if (now === 'gone') return await gone();
        if (now === 'there') return await this.onAdd(videoIds);
        notify(t('queue.addFailed'), { error: true });
        return;
      }
      this.took(data.items);
      const fresh = notInList(data.items, videoIds);
      if (!fresh.length) {
        notify(t('queue.already', { name }), { action: view });
        await this.attachIfIdle(listId, undefined);
        return;
      }
      const r = await this.rpc.editPlaylist(listId, addActions(fresh));
      if (!r.ok) {
        const again = await this.rpc.readPlaylist(listId).catch(() => undefined);
        if (again && !again.exists) return await gone();
        this.log.warn(`add ${fresh.join(',')} to ${listId} failed: ${r.error ?? r.status}`);
        notify(t('queue.addFailed'), { error: true });
        return;
      }
      this.log.info(`added ${fresh.join(',')} to ${listId}`);
      notify(t('queue.added', { name }), { action: view });
      // The count and a panel already showing the list follow from the edit event.
      await this.attachIfIdle(listId, { has: fresh });
    } catch (e) {
      this.log.error('add failed', e);
      notify(t('queue.addFailed'), { error: true });
    }
  }

  /**
   * Watching a video outside any list (watch page or miniplayer): show the
   * list next to it like the native queue, to play after it (§24.2). Another
   * list playing: leave it, the toast is all.
   */
  private async attachIfIdle(listId: string, expect: Expect | undefined): Promise<void> {
    try {
      const playing = await this.rpc.playing();
      if (playing.playlistId || !playing.videoId) return;
      const r = await this.rpc.syncList(listId, expect, true);
      // Reloaded inside the list, the player sits on the list's first entry and
      // its autoplay would skip it; the panel way puts this video on top instead.
      if (r.how === 'navigated') this.attached = r.videoId;
      if (r.how !== 'none') this.log.info(`attached ${listId} to ${r.videoId} (${r.how})`);
    } catch (e) {
      this.log.debug(`attach: ${String(e)}`);
    }
  }

  /** Add to queue went to YouTube's own queue: say why, once per page (§24.1). */
  onNativeAdd(): void {
    if (this.hinted) return;
    if (this.decision === 'noList') notify(t('queue.noList'), { action: { label: t('queue.toSettings'), run: openSettings } });
    else if (this.decision === 'notEditable') notify(t('queue.notEditable', { name: this.listName() }));
    else return;
    this.hinted = true;
  }

  // ---------- §24.4 play and remove watched ----------

  async play(): Promise<void> {
    const listId = this.listId;
    if (!listId) return;
    try {
      const items = await this.readItems();
      this.showButton();
      // The list already playing (say in the miniplayer): carry on with that entry (§24.4).
      const now = await this.rpc.playing();
      const current = now.playlistId === listId ? items.find((i) => i.videoId === now.videoId) : undefined;
      const target = current ?? items[0];
      if (target) await this.rpc.playVideo(target.videoId, listId, !!current);
    } catch (e) {
      this.log.error('play failed', e);
      notify(t('queue.failed'), { error: true });
    }
  }

  onPlayer(e: PlayerEvent): void {
    const listId = this.listId;
    // Another video now: the removed one is behind us.
    if (this.removedHere && this.removedHere.videoId !== e.videoId) this.removedHere = undefined;
    if (this.decision !== 'take' || !listId || e.playlistId !== listId) return;
    // Reloaded inside the list without being in it (fallback attach): the
    // player sits at index 0 and its autoplay would skip the first entry.
    const attached = e.type === 'ended' && e.videoId === this.attached;
    // Removed while playing: we know what came after it, the page does not.
    const removed = this.removedHere?.videoId === e.videoId;
    if (!this.profile.removeWatched && !attached && !removed) return;
    const run = (name: string, fn: () => Promise<void>) => void fn().catch((err) => this.log.error(`${name} failed`, err));
    switch (e.type) {
      case 'near':
        run('prepare next', () => this.prepare(e, listId));
        break;
      case 'ended':
        run('after watched', () => this.afterEnded(e, listId));
        break;
      case 'left':
        if (leftCountsAsWatched(e)) run('remove watched', () => this.removeOnly(e, listId));
        break;
    }
  }

  private async plan(e: PlayerEvent): Promise<Plan> {
    const items = await this.readItems();
    const r = this.removedHere;
    // Removed while playing: nothing left to remove; next is the first entry
    // after it, or added since. None: YouTube's autoplay decides (§47, §48).
    if (r?.videoId === e.videoId) return { videoId: e.videoId, next: nextAfterRemoved(items, r.upTo) };
    return { videoId: e.videoId, ...nextAfter(items, e.videoId, e.index) };
  }

  /** Under 10 s left: work out what comes next, and let the page remove it if the tab closes. */
  private async prepare(e: PlayerEvent, listId: string): Promise<void> {
    const p = await this.plan(e);
    this.pending = p;
    if (p.watched) {
      await this.rpc.armRemoval(listId, p.watched.setVideoId, e.videoId);
      this.armedFor = listId;
    }
  }

  private async takePlan(e: PlayerEvent): Promise<Plan> {
    const p = this.pending?.videoId === e.videoId ? this.pending : undefined;
    this.pending = undefined;
    this.armedFor = undefined;
    await this.rpc.disarm();
    // Something may have been added in the last seconds after the last entry.
    return p && p.next ? p : this.plan(e);
  }

  /** Ended: go to the next entry ourselves, then remove the one just watched (§21.4). */
  private async afterEnded(e: PlayerEvent, listId: string): Promise<void> {
    const p = await this.takePlan(e);
    if (p.next) {
      const now = await this.rpc.playing();
      const stillHere = now.videoId === e.videoId || now.playlistId === listId;
      if (stillHere && now.videoId !== p.next.videoId) {
        const where = await this.rpc.playNext(p.next.videoId, listId);
        this.log.debug(`next ${p.next.videoId} (${where})`);
      }
    }
    if (e.videoId === this.attached) this.attached = undefined;
    if (e.videoId === this.removedHere?.videoId) this.removedHere = undefined;
    if (p.watched && this.profile.removeWatched) await this.remove(listId, p.watched);
  }

  /** Left with under 10 s to go: remove only, no jump. */
  private async removeOnly(e: PlayerEvent, listId: string): Promise<void> {
    const p = await this.takePlan(e);
    if (p.watched) await this.remove(listId, p.watched);
  }

  // ---------- §47, §48 the entry playing removed ----------

  /**
   * Entries of `listId` were removed by Clear all / Remove watched or a drag
   * out of the panel. If the entry playing was one of them, it plays on; when
   * it ends, the first entry after it plays (§24.4 otherwise unchanged).
   */
  noteRemoved(listId: string, before: ListItem[], removed: string[], playing: Playing): void {
    if (this.decision !== 'take' || listId !== this.listId || playing.playlistId !== listId) return;
    const upTo = removedPlaying(before, removed, playing);
    if (!upTo || !playing.videoId) return;
    this.removedHere = { videoId: playing.videoId, upTo };
    // A removal armed for closing the tab (§28.1) would now fail.
    if (this.pending?.videoId === playing.videoId) void this.dropPlan();
  }

  /** An entry dragged out of the panel (§48): removed, or back in its place. */
  async onDropped(d: Dropped): Promise<void> {
    if (!d.ok) {
      this.log.warn(`drag out: removing ${d.videoId} from ${d.listId} failed: ${d.error ?? ''}`);
      notify(t('queue.dropFailed'), { error: true });
      return;
    }
    this.log.info(`drag out: removed ${d.videoId} from ${d.listId}`);
    try {
      this.noteRemoved(d.listId, d.before, [d.setVideoId], await this.rpc.playing());
    } catch (e) {
      this.log.debug(`drag out: ${String(e)}`);
    }
  }

  private async remove(listId: string, item: ListItem): Promise<void> {
    let r: Awaited<ReturnType<Rpc['editPlaylist']>>;
    try {
      r = await this.rpc.editPlaylist(listId, [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: item.setVideoId }]);
    } catch (e) {
      // No answer from the page script, or a network error (findings F6).
      this.log.warn(`watched ${item.videoId}: removing from ${listId} failed`, e);
      notify(t('queue.removeFailed'), { error: true });
      return;
    }
    if (r.ok) {
      this.log.info(`watched ${item.videoId}: removed from ${listId}`);
    } else if (r.status === 400) {
      // Precondition failed: already removed somewhere else (§21.4).
      this.log.debug(`watched ${item.videoId}: already gone from ${listId}`);
    } else {
      this.log.warn(`watched ${item.videoId}: removing from ${listId} failed: ${r.error ?? r.status}`);
      notify(t('queue.removeFailed'), { error: true });
    }
  }
}

function openSettings(): void {
  void browser.runtime.sendMessage({ type: 'YouTube+/open-options', hash: 'queue' });
}
