// Port messages between YouTube tabs and the TL;DR service (design §9).

import type { BadgeState } from './types';

export const PORT_NAME = 'tldr';

export interface VideoRef { videoId: string; title: string }

export type ToService =
  | { type: 'want'; items: (VideoRef & { visible: boolean })[] }
  | { type: 'visible'; shown: string[]; hidden: string[] }
  | { type: 'click'; item: VideoRef }
  | { type: 'regenerate'; item: VideoRef }
  | { type: 'foreground'; visible: boolean }
  | { type: 'ping' };

export type ToTab = { type: 'state'; videoId: string; badge: BadgeState };

export const STATE_KEY = 'tldr/state';
