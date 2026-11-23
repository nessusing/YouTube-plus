// @vitest-environment happy-dom
// Shortcuts as strings (F-11): parse / format round trip, matching by code,
// the recorder's rules (needs a modifier, not one of YouTube's), typing guard.
import { describe, expect, it } from 'vitest';
import {
  checkShortcut, DEFAULT_PIP_SHORTCUT, formatShortcut, fromEvent, isModifierOnly, isTyping, keyName, matches, parseShortcut, youtubeConflict,
} from '@/features/player/shortcut';

const key = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({
  code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta,
});

describe('parse and format', () => {
  it('F-11-AC2 the default is Shift+I', () => {
    expect(parseShortcut(DEFAULT_PIP_SHORTCUT)).toEqual({ ctrl: false, alt: false, shift: true, meta: false, code: 'KeyI' });
  });

  it('F-11-AC2 round-trips, modifiers in a fixed order', () => {
    for (const s of ['Shift+I', 'Ctrl+Alt+P', 'Alt+1', 'Ctrl+Shift+F5', 'Shift+ArrowUp', 'Meta+Comma']) {
      expect(formatShortcut(parseShortcut(s)!)).toBe(s);
    }
    expect(formatShortcut(parseShortcut('alt+ctrl+p')!)).toBe('Ctrl+Alt+P');
  });

  it('F-11-AC2 empty or malformed is no shortcut', () => {
    expect(parseShortcut('')).toBeUndefined();
    expect(parseShortcut(undefined)).toBeUndefined();
    expect(parseShortcut('Hyper+I')).toBeUndefined();
    expect(parseShortcut('Shift+')).toBeUndefined();
    expect(parseShortcut('Ctrl+Shift')).toBeUndefined();
  });

  it('F-11-AC2 key names', () => {
    expect(keyName('KeyI')).toBe('I');
    expect(keyName('Digit7')).toBe('7');
    expect(keyName('F5')).toBe('F5');
    expect(keyName('Comma')).toBe('Comma');
  });
});

describe('matching', () => {
  const k = parseShortcut('Shift+I');

  it('F-11-AC2 by code and exact modifiers', () => {
    expect(matches(k, key('KeyI', { shift: true }))).toBe(true);
    expect(matches(k, key('KeyI'))).toBe(false);
    expect(matches(k, key('KeyI', { shift: true, ctrl: true }))).toBe(false);
    expect(matches(k, key('KeyO', { shift: true }))).toBe(false);
  });

  it('F-11-AC2 no shortcut matches nothing', () => {
    expect(matches(undefined, key('KeyI', { shift: true }))).toBe(false);
  });

  it('F-11-AC2 fromEvent gives back what was pressed', () => {
    expect(formatShortcut(fromEvent(key('KeyP', { ctrl: true, alt: true })))).toBe('Ctrl+Alt+P');
  });

  it('F-11-AC2 modifier keys alone record nothing', () => {
    for (const c of ['ShiftLeft', 'ControlRight', 'AltLeft', 'MetaLeft']) expect(isModifierOnly({ code: c })).toBe(true);
    expect(isModifierOnly({ code: 'KeyA' })).toBe(false);
  });
});

describe('recorder rules', () => {
  it('F-11-AC2 needs at least one modifier', () => {
    expect(checkShortcut(fromEvent(key('KeyI')))).toBe('needModifier');
    expect(checkShortcut(fromEvent(key('KeyI', { shift: true })))).toBeUndefined();
  });

  it("F-11-AC2 refuses YouTube's own", () => {
    for (const s of ['Shift+N', 'Shift+P', 'Shift+Comma', 'Shift+Period', 'Shift+Slash', 'Ctrl+ArrowLeft', 'Ctrl+ArrowRight']) {
      expect(checkShortcut(parseShortcut(s)!)).toBe('youtube');
      expect(youtubeConflict(parseShortcut(s)!)).toBe(s);
    }
    expect(youtubeConflict(parseShortcut('Shift+I')!)).toBeUndefined();
    expect(youtubeConflict(parseShortcut('Ctrl+Shift+N')!)).toBeUndefined();
  });
});

describe('typing guard', () => {
  it('F-11-AC2 inputs, text areas and editable elements', () => {
    document.body.innerHTML = '<input id="a"><textarea id="b"></textarea><div contenteditable="true"><span id="c"></span></div><button id="d"></button>';
    expect(isTyping(document.getElementById('a'))).toBe(true);
    expect(isTyping(document.getElementById('b'))).toBe(true);
    expect(isTyping(document.getElementById('c'))).toBe(true);
    expect(isTyping(document.getElementById('d'))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
