// Settings shared by all features (docs/design.md §3). Feature-specific
// settings join this object as each feature lands.

export type FeatureId = 'tldr' | 'queue' | 'player';
export const FEATURES: FeatureId[] = ['tldr', 'queue', 'player'];

export interface PlayerSettings {
  miniControls: boolean;
  freeDrag: boolean;
  stickyPlayer: boolean;
  backToTop: boolean;
}

/** Caps on what we keep in storage.local (design §4.1). */
export interface StorageLimits {
  logMB: number;
  tldrCacheMB: number;
}

export interface TldrSettings {
  /** output language; 'auto' = the video's spoken language (design §8 Q4) */
  lang: 'auto' | 'zh' | 'en' | 'ja' | 'ko' | 'es' | 'fr' | 'de';
  titleCheck: boolean;
  /** Google account number N in gemini.google.com/u/N (§8 Q9) */
  account: number;
  prefetch: boolean;
  perHour: number;
  perDay: number;
}

export interface QueueSettings {
  /** Name of the private playlist that stores the queue (design §24.1). */
  listName: string;
}

export interface Settings {
  features: Record<FeatureId, boolean>;
  player: PlayerSettings;
  queue: QueueSettings;
  tldr: TldrSettings;
  storage: StorageLimits;
}

export const DEFAULT_SETTINGS: Settings = {
  features: { tldr: true, queue: true, player: true },
  player: { miniControls: true, freeDrag: true, stickyPlayer: true, backToTop: true },
  queue: { listName: 'yt++' },
  tldr: { lang: 'auto', titleCheck: true, account: 0, prefetch: true, perHour: 40, perDay: 200 },
  storage: { logMB: 2, tldrCacheMB: 5 },
};

const KEY = 'settings';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Fill in defaults for anything missing, so old stored settings keep working after upgrades. */
export function withDefaults(stored: DeepPartial<Settings> | undefined): Settings {
  const s = stored ?? {};
  return {
    features: { ...DEFAULT_SETTINGS.features, ...s.features },
    player: { ...DEFAULT_SETTINGS.player, ...s.player },
    queue: { ...DEFAULT_SETTINGS.queue, ...s.queue },
    tldr: { ...DEFAULT_SETTINGS.tldr, ...s.tldr },
    storage: { ...DEFAULT_SETTINGS.storage, ...s.storage },
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
