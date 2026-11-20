// Per-identity queue settings and snapshots (design §22 Q17/Q22, §24.7).
// An identity is a hash of ytcfg DATASYNC_ID (channel + Google account); the
// raw ID is never stored. Used by the content script and the settings page.

import { profileWithDefaults, type QueueProfile, type Snapshot } from './core';
import { LEGACY_KEYS, PROFILE_PREFIX, SNAPSHOT_PREFIX } from './keys';

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
export const snapshotKey = (id: string) => SNAPSHOT_PREFIX + id;

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

export async function getSnapshot(id: string): Promise<Snapshot | undefined> {
  const k = snapshotKey(id);
  return (await browser.storage.local.get(k))[k] as Snapshot | undefined;
}

export async function saveSnapshot(id: string, s: Snapshot): Promise<void> {
  await browser.storage.local.set({ [snapshotKey(id)]: s });
}

/**
 * Drop what the old sync left behind. Its list was found by name, so it is not
 * carried over: every identity starts with no list chosen (design §29 step 2).
 */
export async function removeLegacyKeys(): Promise<void> {
  await browser.storage.sync.remove(LEGACY_KEYS.sync);
  await browser.storage.local.remove(LEGACY_KEYS.local);
}
