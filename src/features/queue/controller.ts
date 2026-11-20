// Playlist mode, isolated side (design §24): decide whether to take over Add
// to queue, add to the chosen list, keep the top bar button current, and after
// a video from the list is watched, move on to the next one and remove it.

import { t } from '@/core/i18n';
import type { Toggleable } from '@/core/dom';
import type { Logger } from '@/core/log';
import type { PlayerEvent } from './bridge';
import {
  addActions, decideTakeover, DEFAULT_PROFILE, isWatchedHere, nextAfter, notInList, type ListItem, type QueueMode, type QueueProfile, type Takeover,
} from './core';
import { PROTOCOL_ERROR_KEY } from './keys';
import type { PlayButton } from './play-button';
import { getProfile, onProfileChanged, updateProfile, type Identity } from './profiles';
import type { Rpc } from './rpc';
import { toast } from './toast';

/** Re-read the list for the button count at most this often when the tab comes back. */
const RECOUNT_MS = 30_000;

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
  private toolsOn = false;
  /** The video reloaded inside the list by the fallback attach (§24.2), until it ends. */
  private attached: string | undefined;

  constructor(
    private rpc: Rpc,
    private log: Logger,
    private featureOn: () => boolean,
    private tools: Toggleable,
    private button: PlayButton,
  ) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.modeToast) this.showModeToast(this.modeToast);
      if (this.decision === 'take' && Date.now() - this.lastRead > RECOUNT_MS) void this.recount();
    });
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
      if (!data.exists) await this.listGone();
      else this.editable = false;
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

  /** The list was deleted elsewhere: forget it for this identity (§24.5). */
  private async listGone(): Promise<void> {
    const id = this.profile.listId;
    this.log.info(`queue playlist ${id} no longer exists; cleared the choice`);
    if (this.me?.key) {
      this.profile = await updateProfile(this.me.key, (p) => {
        delete p.listId;
        delete p.listName;
      });
    }
    this.editable = undefined;
    this.items = [];
  }

  private async readItems(): Promise<ListItem[]> {
    const data = await this.rpc.readPlaylist(this.profile.listId!);
    this.items = data.items;
    this.lastRead = Date.now();
    return this.items;
  }

  private async recount(): Promise<void> {
    try {
      await this.readItems();
      this.showButton();
    } catch (e) {
      this.log.debug(`recount failed: ${String(e)}`);
    }
  }

  private showButton(): void {
    if (this.decision === 'take') this.button.show(this.listName(), this.items.length);
    else this.button.hide();
  }

  private async apply(): Promise<void> {
    this.decision = decideTakeover({
      featureOn: this.featureOn(),
      profile: this.profile,
      loggedIn: !!this.me?.loggedIn,
      editable: this.editable,
      protocolError: this.protocolError,
    });
    await this.rpc.setTakeover({ decision: this.decision, label: t('queue.addTo', { name: this.listName() }) });
    this.showButton();
  }

  private onProfile(p: QueueProfile): void {
    const old = this.profile;
    if (old.mode !== p.mode) this.showModeToast(p.mode);
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
    toast(t(mode === 'playlist' ? 'queue.switchedPlaylist' : 'queue.switchedNative'), { label: t('queue.reload'), run: () => location.reload() }, 10_000);
  }

  // ---------- §24.2 add ----------

  async onAdd(videoIds: string[]): Promise<void> {
    const listId = this.listId;
    if (this.decision !== 'take' || !listId) return;
    const name = this.listName();
    const gone = async () => {
      await this.listGone();
      await this.apply();
      toast(t('queue.listGone', { name }), { label: t('queue.toSettings'), run: openSettings });
    };
    const view = { label: t('queue.view'), run: () => void this.rpc.openPlaylist(listId) };
    try {
      // The server ignores DEDUPE_OPTION_SKIP and appends a duplicate, so check first.
      const data = await this.rpc.readPlaylist(listId);
      if (!data.exists) return await gone();
      this.items = data.items;
      this.lastRead = Date.now();
      const fresh = notInList(data.items, videoIds);
      if (!fresh.length) {
        toast(t('queue.already', { name }), view);
        await this.showInPlayback(listId, false);
        return;
      }
      const r = await this.rpc.editPlaylist(listId, addActions(fresh));
      if (!r.ok) {
        const again = await this.rpc.readPlaylist(listId).catch(() => undefined);
        if (again && !again.exists) return await gone();
        this.log.warn(`add ${fresh.join(',')} to ${listId} failed: ${r.error ?? r.status}`);
        toast(t('queue.addFailed'));
        return;
      }
      this.log.info(`added ${fresh.join(',')} to ${listId}`);
      toast(t('queue.added', { name }), view);
      await this.showInPlayback(listId, true);
      await this.recount();
    } catch (e) {
      this.log.error('add failed', e);
      toast(t('queue.addFailed'));
    }
  }

  /**
   * Make the list show next to what is playing, like the native queue (§24.2):
   * already playing it → refresh the panel; watching a video outside any list
   * (watch page or miniplayer) → attach the list to it. Another list playing:
   * leave it, the toast is all.
   */
  private async showInPlayback(listId: string, changed: boolean): Promise<void> {
    try {
      const playing = await this.rpc.playing();
      if (playing.playlistId === listId) {
        if (changed) await this.rpc.refreshPlaylist();
      } else if (!playing.playlistId && playing.videoId) {
        const how = await this.rpc.attachList(listId);
        // Reloaded inside the list, the player sits on the list's first entry
        // and its autoplay would skip it; the panel way puts this video on top.
        if (how === 'navigated') this.attached = playing.videoId;
        if (how) this.log.info(`attached ${listId} to ${playing.videoId} (${how})`);
      }
    } catch (e) {
      this.log.debug(`show list in playback: ${String(e)}`);
    }
  }

  /** Add to queue went to YouTube's own queue: say why, once per page (§24.1). */
  onNativeAdd(): void {
    if (this.hinted) return;
    if (this.decision === 'noList') toast(t('queue.noList'), { label: t('queue.toSettings'), run: openSettings }, 10_000);
    else if (this.decision === 'notEditable') toast(t('queue.notEditable', { name: this.listName() }), undefined, 8000);
    else return;
    this.hinted = true;
  }

  // ---------- §24.4 play and remove watched ----------

  async play(): Promise<void> {
    const listId = this.listId;
    if (!listId) return;
    try {
      const first = (await this.readItems())[0];
      this.showButton();
      if (first) await this.rpc.playVideo(first.videoId, listId);
    } catch (e) {
      this.log.error('play failed', e);
      toast(t('queue.failed'));
    }
  }

  onPlayer(e: PlayerEvent): void {
    const listId = this.listId;
    if (this.decision !== 'take' || !listId || e.playlistId !== listId) return;
    // Reloaded inside the list without being in it (fallback attach): the
    // player sits at index 0 and its autoplay would skip the first entry.
    const attached = e.type === 'ended' && e.videoId === this.attached;
    if (!this.profile.removeWatched && !attached) return;
    const run = (name: string, fn: () => Promise<void>) => void fn().catch((err) => this.log.error(`${name} failed`, err));
    switch (e.type) {
      case 'near':
        run('prepare next', () => this.prepare(e, listId));
        break;
      case 'ended':
        run('after watched', () => this.afterEnded(e, listId));
        break;
      case 'left':
        if (isWatchedHere(e.currentTime, e.duration, false)) run('remove watched', () => this.removeOnly(e, listId));
        break;
    }
  }

  private async plan(e: PlayerEvent): Promise<Plan> {
    const items = await this.readItems();
    return { videoId: e.videoId, ...nextAfter(items, e.videoId, e.index) };
  }

  /** Under 10 s left: work out what comes next, and let the page remove it if the tab closes. */
  private async prepare(e: PlayerEvent, listId: string): Promise<void> {
    const p = await this.plan(e);
    this.pending = p;
    if (p.watched) await this.rpc.armRemoval(listId, p.watched.setVideoId, e.videoId);
  }

  private async takePlan(e: PlayerEvent): Promise<Plan> {
    const p = this.pending?.videoId === e.videoId ? this.pending : undefined;
    this.pending = undefined;
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
      if (stillHere && now.videoId !== p.next.videoId) await this.rpc.playVideo(p.next.videoId, listId);
    }
    if (e.videoId === this.attached) this.attached = undefined;
    if (p.watched && this.profile.removeWatched) await this.remove(listId, p.watched);
  }

  /** Left with under 10 s to go: remove only, no jump. */
  private async removeOnly(e: PlayerEvent, listId: string): Promise<void> {
    const p = await this.takePlan(e);
    if (p.watched) await this.remove(listId, p.watched);
  }

  private async remove(listId: string, item: ListItem): Promise<void> {
    const r = await this.rpc.editPlaylist(listId, [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: item.setVideoId }]);
    if (r.ok) {
      this.log.info(`watched ${item.videoId}: removed from ${listId}`);
    } else if (r.status === 400) {
      // Precondition failed: already removed somewhere else (§21.4).
      this.log.debug(`watched ${item.videoId}: already gone from ${listId}`);
    } else {
      this.log.warn(`watched ${item.videoId}: removing from ${listId} failed: ${r.error ?? r.status}`);
      toast(t('queue.removeFailed'));
    }
    await this.recount();
  }
}

function openSettings(): void {
  void browser.runtime.sendMessage({ type: 'YouTube+/open-options', hash: 'queue' });
}
