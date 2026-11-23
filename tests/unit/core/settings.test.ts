import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, withDefaults } from '@/core/settings';

describe('withDefaults', () => {
  it('F-01-AC1 returns defaults for nothing stored', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('F-01-AC1 keeps stored values and fills in new keys', () => {
    const s = withDefaults({ features: { queue: false }, player: { backToTop: false } });
    expect(s.features).toEqual({ tldr: true, queue: false, player: true, danmaku: false });
    expect(s.player.backToTop).toBe(false);
    expect(s.player.miniControls).toBe(true);
  });

  it('F-01-AC1 keeps the extension on unless it was turned off', () => {
    expect(withDefaults({}).enabled).toBe(true);
    expect(withDefaults({ enabled: false }).enabled).toBe(false);
  });

  it('F-12-AC16 fills danmaku params group by group and drops bad values', () => {
    const s = withDefaults({ danmaku: { placement: 'ai', params: { display: { screenSec: 4, gapSec: 'x' as never }, ai: { fallback: 'nope' as never } } } });
    expect(s.danmaku.placement).toBe('ai');
    expect(s.danmaku.active).toBe(true);
    expect(s.danmaku.params.display.screenSec).toBe(4);
    expect(s.danmaku.params.display.gapSec).toBe(DEFAULT_SETTINGS.danmaku.params.display.gapSec);
    expect(s.danmaku.params.ai.fallback).toBe('local');
    expect(s.danmaku.params.local).toEqual(DEFAULT_SETTINGS.danmaku.params.local);
  });

  it('F-01-AC1 does not share nested objects with the defaults', () => {
    const s = withDefaults(undefined);
    s.features.tldr = false;
    expect(DEFAULT_SETTINGS.features.tldr).toBe(true);
    s.danmaku.params.local.spoilerWords.push('x');
    expect(DEFAULT_SETTINGS.danmaku.params.local.spoilerWords).not.toContain('x');
  });
});
