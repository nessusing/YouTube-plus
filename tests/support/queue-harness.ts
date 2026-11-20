// Builds a QueueController wired to a FakeYouTube the way index.ts wires it
// to the page script, with the top bar button, toasts and storage observable.
// Use with fake timers: `await h.settle()` lets every retry and batch finish.

import { vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setLang } from '@/core/i18n';
import type { Logger } from '@/core/log';
import { QueueController } from '@/features/queue/controller';
import type { QueueProfile } from '@/features/queue/core';
import { PROFILE_PREFIX } from '@/features/queue/keys';
import type { PlayButton } from '@/features/queue/play-button';
import { FakeYouTube } from './fake-youtube';
import { toasts, type ToastCall } from './toasts';


export interface Harness {
  yt: FakeYouTube;
  ctl: QueueController;
  button: PlayButton & { visible: boolean; name?: string; count?: number; shows: number };
  tools: { on: boolean };
  log: Logger & { lines: { level: string; msg: string }[] };
  feature: { on: boolean };
  setProfile(p: Partial<QueueProfile>): Promise<void>;
  profile(): Promise<QueueProfile | undefined>;
  settle(ms?: number): Promise<void>;
  setVisible(v: boolean): void;
  toasts: ToastCall[];
}

let current: Harness | undefined;

export async function setup(init: {
  profile?: Partial<QueueProfile>;
  lists?: Record<string, string[]>;
  before?: (yt: FakeYouTube) => void;
  start?: boolean;
} = {}): Promise<Harness> {
  current?.ctl.dispose();
  fakeBrowser.reset();
  setLang('en');
  toasts.length = 0;
  setVisibility(true);

  const yt = new FakeYouTube();
  for (const [id, vids] of Object.entries(init.lists ?? {})) yt.addList(id, `List ${id}`, vids);
  init.before?.(yt);

  const button = {
    visible: false, name: undefined as string | undefined, count: undefined as number | undefined, shows: 0,
    show(name: string, count: number) {
      this.visible = true;
      this.name = name;
      this.count = count;
      this.shows++;
    },
    hide() {
      this.visible = false;
    },
  };
  const tools = { on: false, enable() { this.on = true; }, disable() { this.on = false; } };
  const lines: { level: string; msg: string }[] = [];
  const mk = (level: string) => (...a: unknown[]) => void lines.push({ level, msg: a.map(String).join(' ') });
  const log = { lines, debug: mk('debug'), info: mk('info'), warn: mk('warn'), error: mk('error') };
  const feature = { on: true };

  const key = `${PROFILE_PREFIX}${yt.me.key}`;
  if (init.profile) await fakeBrowser.storage.sync.set({ [key]: { mode: 'native', removeWatched: true, ...init.profile } });

  const ctl = new QueueController(yt.rpc, log, () => feature.on, tools, button);
  yt.onEdited = (e) => ctl.onEdited(e);
  yt.onPanel = (id, s) => ctl.onPanel(id, s);

  const h: Harness = {
    yt, ctl, button, tools, log, feature, toasts,
    async setProfile(p) {
      const old = (await fakeBrowser.storage.sync.get(key))[key] ?? { mode: 'native', removeWatched: true };
      await fakeBrowser.storage.sync.set({ [key]: { ...old, ...p } });
    },
    async profile() {
      return (await fakeBrowser.storage.sync.get(key))[key] as QueueProfile | undefined;
    },
    async settle(ms = 20_000) {
      await vi.advanceTimersByTimeAsync(ms);
    },
    setVisible(v) {
      setVisibility(v);
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
  current = h;
  if (init.start !== false) {
    await startRefresh(h);
  }
  return h;
}

async function startRefresh(h: Harness): Promise<void> {
  const p = h.ctl.refresh();
  await vi.advanceTimersByTimeAsync(0);
  await p;
  await h.settle();
}

function setVisibility(v: boolean): void {
  Object.defineProperty(document, 'visibilityState', { value: v ? 'visible' : 'hidden', configurable: true });
}
