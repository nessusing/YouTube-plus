// Settings shared by all features (docs/design.md §3). Feature-specific
// settings join this object as each feature lands. The queue's settings are
// kept per YouTube identity instead (features/queue/profiles.ts, design §22).

export type FeatureId = 'tldr' | 'queue' | 'player';

/** UI language = YouTube's (core/youtube-lang.ts); TL;DR output is in each video's own language. */
export type Lang = 'en' | 'zh';

export function detectLang(): Lang {
  const l = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return /^zh\b/i.test(l) ? 'zh' : 'en';
}
export const FEATURES: FeatureId[] = ['tldr', 'queue', 'player'];

export interface PlayerSettings {
  miniControls: boolean;
  freeDrag: boolean;
  stickyPlayer: boolean;
  backToTop: boolean;
  /** Loop button in the player (§40.2); off by default. */
  loopButton: boolean;
  /** Minimize button in the miniplayer (§44). */
  miniMinimize: boolean;
  /** Pop the miniplayer out to a Document PiP window (§50): the button and the shortcut. */
  pip: boolean;
}

/** Keyboard shortcuts, as "Shift+I" (features/player/shortcut.ts); "" = none. */
export interface ShortcutSettings {
  /** Pop out / back in (§50). */
  pip: string;
}

/** Caps on what we keep in storage.local (design §4.1). */
export interface StorageLimits {
  logMB: number;
  tldrCacheMB: number;
}

export interface TldrSettings {
  titleCheck: boolean;
  /** Google account number N in gemini.google.com/u/N (§8 Q9) */
  account: number;
  prefetch: boolean;
  perHour: number;
  perDay: number;
  /** Videos per Gemini request (1 = one at a time). */
  batchSize: number;
}

/** Page notifications (design §46). The sideways position is per machine, in storage.local. */
export interface NotifySettings {
  position: 'bottom' | 'top';
  /** Shown at once, 1–5; the oldest goes first. */
  maxVisible: number;
  /** Seconds shown, 2–30: plain, with a button, error. */
  plainSec: number;
  actionSec: number;
  errorSec: number;
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
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  lang: 'en',
  features: { tldr: true, queue: true, player: true },
  player: { miniControls: true, freeDrag: true, stickyPlayer: true, backToTop: true, loopButton: false, miniMinimize: true, pip: true },
  shortcuts: { pip: 'Shift+I' },
  tldr: { titleCheck: true, account: 0, prefetch: true, perHour: 40, perDay: 200, batchSize: 5 },
  storage: { logMB: 2, tldrCacheMB: 5 },
  notify: { position: 'bottom', maxVisible: 3, plainSec: 4, actionSec: 6, errorSec: 8 },
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
