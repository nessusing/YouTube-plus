export const PLAYER_PAGE_CHECKS = ['check.player.bar', 'check.player.mini', 'check.player.float', 'check.player.pip'] as const;
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
/** storage.local key: the PiP window's last size (§50). */
export const PIP_SIZE_KEY = 'player/pipSize';
/** On <html> while the player is popped out to a PiP window (§50). */
export const PIP_ATTR = 'data-ytpp-pip';
/** Sent on document when popping out or back in (§50). */
export const PIP_CHANGE_EVENT = 'ytpp-pip-change';
/** Isolated → page script: run the command in html[data-ytpp-pip-cmd] on the popped-out player (§50). */
export const PIP_CMD_EVENT = 'ytpp-pip-cmd';
export const PIP_CMD_ATTR = 'data-ytpp-pip-cmd';
/** Page script → isolated: the playing video's id, written on request (§50). */
export const PIP_VID_ATTR = 'data-ytpp-pip-vid';
