// Where things live for the e2e suite. Nothing here is inside the repo except
// the built extension.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROFILE_DIR = process.env.YTPP_E2E_PROFILE ?? join(homedir(), '.cache', 'ytpp-e2e-profile');
export const EXTENSION_DIR = fileURLToPath(new URL('../../../.output/chrome-mv3', import.meta.url));

/** Every list the suite creates starts with this; nothing else may be edited or deleted. */
export const LIST_PREFIX = 'YouTube+ e2e';

export const LAUNCH_ARGS = [
  `--disable-extensions-except=${EXTENSION_DIR}`,
  `--load-extension=${EXTENSION_DIR}`,
  '--autoplay-policy=no-user-gesture-required',
  // Silent: the browser plays no sound; the player's own mute state and volume are untouched.
  '--mute-audio',
  '--lang=en-US',
  '--window-size=1400,1000',
];

/**
 * Public videos that have been up for years. Any will do as long as it is
 * not age-restricted or a live stream; replace one here if it disappears.
 */
export const VIDEOS = {
  zoo: 'jNQXAC9IVRw', // 0:19
  a: 'dQw4w9WgXcQ',
  b: '9bZkp7q19f0',
  c: 'kJQP7kiw5Fk',
  d: 'JGwWNGJdvx8',
  e: 'OPf0YbXqDm0',
};

/**
 * The browser window while the suite runs (YTPP_E2E_WINDOW):
 * normal: an ordinary window; minimized: minimised as soon as it opens;
 * headless: no window at all.
 */
export const WINDOW = (process.env.YTPP_E2E_WINDOW ?? 'normal') as 'normal' | 'minimized' | 'headless';
