// Settings shared by all features (F-01). Feature-specific
// settings join this object as each feature lands. The queue's settings are
// kept per YouTube identity instead (features/queue/profiles.ts, F-05).

import { type DanmakuParams, DEFAULT_PARAMS, paramsWithDefaults } from '@/features/danmaku/params';

export type FeatureId = 'tldr' | 'queue' | 'player' | 'danmaku';

/** UI language = YouTube's (core/youtube-lang.ts); TL;DR output is in each video's own language. */
export type Lang = 'en' | 'zh';

export function detectLang(): Lang {
  const l = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return /^zh\b/i.test(l) ? 'zh' : 'en';
}
export const FEATURES: FeatureId[] = ['tldr', 'queue', 'player', 'danmaku'];

export interface PlayerSettings {
  miniControls: boolean;
  freeDrag: boolean;
  stickyPlayer: boolean;
  backToTop: boolean;
  /** Loop button in the player (F-10); off by default. */
  loopButton: boolean;
  /** Minimize button in the miniplayer (F-07). */
  miniMinimize: boolean;
  /** Pop the miniplayer out to a Document PiP window (F-11): the button and the shortcut. */
  pip: boolean;
}

/** Keyboard shortcuts, as "Shift+I" (features/player/shortcut.ts); "" = none. */
export interface ShortcutSettings {
  /** Pop out / back in (F-11). */
  pip: string;
}

/** Caps on what we keep in storage.local (F-01-AC5). */
export interface StorageLimits {
  logMB: number;
  tldrCacheMB: number;
}

export interface TldrSettings {
  titleCheck: boolean;
  /** Google account number N in gemini.google.com/u/N (F-03 Q9) */
  account: number;
  prefetch: boolean;
  perHour: number;
  perDay: number;
  /** Videos per Gemini request (1 = one at a time). */
  batchSize: number;
}

/** Page notifications (F-02). The sideways position is per machine, in storage.local. */
export interface NotifySettings {
  position: 'bottom' | 'top';
  /** Shown at once, 1–5; the oldest goes first. */
  maxVisible: number;
  /** Seconds shown, 2–30: plain, with a button, error. */
  plainSec: number;
  actionSec: number;
  errorSec: number;
}

/**
 * How comments show (F-12): one caption-style card at a time at the top, single
 * lines flying right to left, or a panel on the player's right listing them all.
 */
export type DanmakuStyle = 'card' | 'fly' | 'panel';
export const DANMAKU_STYLES: DanmakuStyle[] = ['card', 'fly', 'panel'];

/** Comment danmaku (F-12). The feature switch is features.danmaku, off by default. */
export interface DanmakuSettings {
  /** The player button, remembered for every video like the captions button. */
  active: boolean;
  /** Where comments without timestamps go: spread locally or placed by Gemini. */
  placement: 'local' | 'ai';
  style: DanmakuStyle;
  /** Source label on each card, timings in the button's tooltip. */
  debug: boolean;
  params: DanmakuParams;
}

export interface Settings {
  /** Master switch: when false, no feature runs. */
  enabled: boolean;
  lang: Lang;
  features: Record<FeatureId, boolean>;
  player: PlayerSettings;
  shortcuts: ShortcutSettings;
  tldr: TldrSettings;
  storage: StorageLimits;
  notify: NotifySettings;
  danmaku: DanmakuSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  lang: 'en',
  features: { tldr: true, queue: true, player: true, danmaku: false },
  player: { miniControls: true, freeDrag: true, stickyPlayer: true, backToTop: true, loopButton: false, miniMinimize: true, pip: true },
  shortcuts: { pip: 'Shift+I' },
  tldr: { titleCheck: true, account: 0, prefetch: true, perHour: 40, perDay: 200, batchSize: 5 },
  storage: { logMB: 2, tldrCacheMB: 5 },
  notify: { position: 'bottom', maxVisible: 3, plainSec: 4, actionSec: 6, errorSec: 8 },
  danmaku: { active: true, placement: 'local', style: 'card', debug: false, params: DEFAULT_PARAMS },
};

/** A feature runs only when both the master switch and its own switch are on. */
export function featureOn(s: Settings, f: FeatureId): boolean {
  return s.enabled && s.features[f];
}

const KEY = 'settings';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Fill in defaults for anything missing, so old stored settings keep working after upgrades. */
export function withDefaults(stored: DeepPartial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    enabled: s.enabled !== false,
    lang: s.lang === 'en' || s.lang === 'zh' ? s.lang : detectLang(),
    features: { ...DEFAULT_SETTINGS.features, ...s.features },
    player: { ...DEFAULT_SETTINGS.player, ...s.player },
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...s.shortcuts },
    tldr: { ...DEFAULT_SETTINGS.tldr, ...s.tldr },
    storage: { ...DEFAULT_SETTINGS.storage, ...s.storage },
    notify: { ...DEFAULT_SETTINGS.notify, ...s.notify },
    danmaku: {
      active: s.danmaku?.active !== false,
      placement: s.danmaku?.placement === 'ai' ? 'ai' : 'local',
      style: DANMAKU_STYLES.includes(s.danmaku?.style as DanmakuStyle) ? s.danmaku!.style as DanmakuStyle : 'card',
      debug: s.danmaku?.debug === true,
      params: paramsWithDefaults(s.danmaku?.params),
    },
  };
}

export async function getSettings(): Promise<Settings> {
  const got = await browser.storage.sync.get(KEY);
  return withDefaults(got[KEY] as DeepPartial<Settings> | undefined);
}

export async function saveSettings(s: Settings): Promise<void> {
  await browser.storage.sync.set({ [KEY]: s });
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'sync' && KEY in changes) cb(withDefaults(changes[KEY].newValue as DeepPartial<Settings>));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
