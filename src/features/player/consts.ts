export const PLAYER_PAGE_CHECKS = ['check.player.bar', 'check.player.mini', 'check.player.float', 'check.player.pip'] as const;
/** storage.local key for the remembered miniplayer position (F-07-AC3). */
export const MINI_POS_KEY = 'player/miniPos';
/** storage.local key for the remembered position of the watch page's small window (F-08). */
export const FLOAT_POS_KEY = 'player/floatPos';
/** Events the isolated side sends the page script to turn loop on / off (F-10). */
export const LOOP_ON_EVENT = 'ytpp-loop-on';
export const LOOP_OFF_EVENT = 'ytpp-loop-off';
/** storage.local key: the miniplayer is minimized to the bar (F-07). */
export const MINI_MIN_KEY = 'player/miniMinimized';
/** The minimized miniplayer's bar (F-07); notifications rise above it (F-02). */
export const MINI_BAR_TAG = 'ytpp-mini-bar';
/** storage.local key: the PiP window's last size (F-11). */
export const PIP_SIZE_KEY = 'player/pipSize';
/** On <html> while the player is popped out to a PiP window (F-11). */
export const PIP_ATTR = 'data-ytpp-pip';
/** Sent on document when popping out or back in (F-11). */
export const PIP_CHANGE_EVENT = 'ytpp-pip-change';
/** Isolated → page script: run the command in html[data-ytpp-pip-cmd] on the popped-out player (F-11). */
export const PIP_CMD_EVENT = 'ytpp-pip-cmd';
export const PIP_CMD_ATTR = 'data-ytpp-pip-cmd';
/** Page script → isolated: the playing video's id, written on request (F-11). */
export const PIP_VID_ATTR = 'data-ytpp-pip-vid';
