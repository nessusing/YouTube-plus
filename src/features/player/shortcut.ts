// Keyboard shortcuts as stored strings, e.g. "Shift+I" or "Ctrl+Alt+P" (F-11).
// Keys are matched by KeyboardEvent.code, so the keyboard layout and Shift do
// not change what a letter is. Pure: unit tested.

export interface Shortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** KeyboardEvent.code, e.g. "KeyI", "Digit1", "F5", "Comma". */
  code: string;
}

type KeyLike = Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'code'>;

export const DEFAULT_PIP_SHORTCUT = 'Shift+I';

const MODS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
/** Codes that are only modifiers: pressing them alone records nothing. */
const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/;

/** "KeyI" → "I", "Digit1" → "1", anything else as is ("F5", "ArrowUp", "Comma"). */
export function keyName(code: string): string {
  const m = /^(?:Key|Digit)(.)$/.exec(code);
  return m ? m[1]! : code;
}

function codeOf(name: string): string {
  if (/^[A-Z]$/.test(name)) return `Key${name}`;
  if (/^[0-9]$/.test(name)) return `Digit${name}`;
  return name;
}

/** Parse "Shift+I"; undefined for "" (no shortcut) or anything malformed. */
export function parseShortcut(s: string | undefined): Shortcut | undefined {
  if (!s) return undefined;
  const parts = s.split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return undefined;
  const out: Shortcut = { ctrl: false, alt: false, shift: false, meta: false, code: codeOf(key.length === 1 ? key.toUpperCase() : key) };
  for (const p of parts) {
    const mod = MODS.find((m) => m.toLowerCase() === p.toLowerCase());
    if (!mod) return undefined;
    out[mod.toLowerCase() as 'ctrl' | 'alt' | 'shift' | 'meta'] = true;
  }
  if (MODIFIER_CODES.test(out.code)) return undefined;
  return out;
}

export function formatShortcut(k: Shortcut): string {
  return [k.ctrl && 'Ctrl', k.alt && 'Alt', k.shift && 'Shift', k.meta && 'Meta', keyName(k.code)].filter(Boolean).join('+');
}

export function fromEvent(e: KeyLike): Shortcut {
  return { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: e.code };
}

export function matches(k: Shortcut | undefined, e: KeyLike): boolean {
  return !!k && k.code === e.code && k.ctrl === e.ctrlKey && k.alt === e.altKey && k.shift === e.shiftKey && k.meta === e.metaKey;
}

export function isModifierOnly(e: Pick<KeyboardEvent, 'code'>): boolean {
  return MODIFIER_CODES.test(e.code);
}

export function hasModifier(k: Shortcut): boolean {
  return k.ctrl || k.alt || k.shift || k.meta;
}

/**
 * YouTube's own shortcuts that take a modifier (its "?" list, 2026-11-21);
 * the unmodified ones cannot clash since ours needs a modifier.
 */
const YOUTUBE_TAKEN = [
  'Shift+P', // previous video
  'Shift+N', // next video
  'Shift+Comma', // slower (<)
  'Shift+Period', // faster (>)
  'Shift+Slash', // shortcut list (?)
  'Shift+Equal', // caption font size up (+)
  'Ctrl+ArrowLeft', // previous chapter
  'Ctrl+ArrowRight', // next chapter
];

/** The YouTube shortcut `k` clashes with, if any. */
export function youtubeConflict(k: Shortcut): string | undefined {
  const s = formatShortcut(k);
  return YOUTUBE_TAKEN.find((t) => t === s);
}

/** For the recorder: an error key for `k`, or undefined if it can be saved. */
export function checkShortcut(k: Shortcut): 'needModifier' | 'youtube' | undefined {
  if (!hasModifier(k)) return 'needModifier';
  if (youtubeConflict(k)) return 'youtube';
  return undefined;
}

/** Focus is somewhere text goes: shortcuts stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
}
