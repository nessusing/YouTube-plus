// Per-identity queue settings (F-05 Q17/Q22, F-05-AC1).
// An identity is a hash of ytcfg DATASYNC_ID (channel + Google account); the
// raw ID is never stored. Used by the content script and the settings page.

import { profileWithDefaults, type QueueProfile } from './core';
import { LEGACY_KEYS, PROFILE_PREFIX } from './keys';

/** Who a YouTube tab is signed in as; from the page (main-world.ts). */
export interface Identity {
  loggedIn: boolean;
  /** Hash of DATASYNC_ID; absent when signed out. */
  key?: string;
  name?: string;
  avatar?: string;
  /** Acting as a brand channel (X-Goog-PageId is sent). */
  brand: boolean;
}

export const profileKey = (id: string) => PROFILE_PREFIX + id;

export async function getProfile(id: string): Promise<QueueProfile> {
  const k = profileKey(id);
  return profileWithDefaults((await browser.storage.sync.get(k))[k] as Partial<QueueProfile> | undefined);
}

export async function saveProfile(id: string, p: QueueProfile): Promise<void> {
  await browser.storage.sync.set({ [profileKey(id)]: p });
}

export async function updateProfile(id: string, mut: (p: QueueProfile) => void): Promise<QueueProfile> {
  const p = await getProfile(id);
  mut(p);
  await saveProfile(id, p);
  return p;
}

export function onProfileChanged(id: string, cb: (p: QueueProfile) => void): () => void {
  const k = profileKey(id);
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'sync' && k in changes) cb(profileWithDefaults(changes[k]?.newValue as Partial<QueueProfile> | undefined));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/**
 * Drop what the old sync left behind. Its list was found by name, so it is not
 * carried over: every identity starts with no list chosen (F-05 step 2).
 * Also the Clear all snapshots, gone with their undo (F-06).
 */
export async function removeLegacyKeys(): Promise<void> {
  await browser.storage.sync.remove(LEGACY_KEYS.sync);
  const local = Object.keys(await browser.storage.local.get(null)).filter((k) => LEGACY_KEYS.localPrefixes.some((p) => k.startsWith(p)));
  await browser.storage.local.remove([...LEGACY_KEYS.local, ...local]);
}
