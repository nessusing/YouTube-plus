import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, withDefaults } from './settings';

describe('withDefaults', () => {
  it('returns defaults for nothing stored', () => {
    expect(withDefaults(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps stored values and fills in new keys', () => {
    const s = withDefaults({ features: { queue: false }, player: { backToTop: false } });
    expect(s.features).toEqual({ tldr: true, queue: false, player: true });
    expect(s.player.backToTop).toBe(false);
    expect(s.player.miniControls).toBe(true);
  });

  it('keeps the extension on unless it was turned off', () => {
    expect(withDefaults({}).enabled).toBe(true);
    expect(withDefaults({ enabled: false }).enabled).toBe(false);
  });

  it('does not share nested objects with the defaults', () => {
    const s = withDefaults(undefined);
    s.features.tldr = false;
    expect(DEFAULT_SETTINGS.features.tldr).toBe(true);
  });
});
