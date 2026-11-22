export const PLAYER_PAGE_CHECKS = ['check.player.bar', 'check.player.mini', 'check.player.float'] as const;
/** storage.local key for the remembered miniplayer position (§35.3). */
export const MINI_POS_KEY = 'player/miniPos';
/** storage.local key for the remembered position of the watch page's small window (§49). */
export const FLOAT_POS_KEY = 'player/floatPos';
/** Events the isolated side sends the page script to turn loop on / off (§40.2). */
export const LOOP_ON_EVENT = 'ytpp-loop-on';
export const LOOP_OFF_EVENT = 'ytpp-loop-off';
/** storage.local key: the miniplayer is minimized to the bar (§44). */
export const MINI_MIN_KEY = 'player/miniMinimized';
/** The minimized miniplayer's bar (§44); notifications rise above it (design §46). */
export const MINI_BAR_TAG = 'ytpp-mini-bar';
