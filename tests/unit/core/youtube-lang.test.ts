import { describe, expect, it } from 'vitest';
import { hlFromPrefCookie, langFromHl } from '@/core/youtube-lang';

describe('langFromHl', () => {
  it('F-04-AC1 maps any Chinese to zh and everything else to en', () => {
    expect(langFromHl('zh-Hans-CN')).toBe('zh');
    expect(langFromHl('zh-CN')).toBe('zh');
    expect(langFromHl('zh-TW')).toBe('zh');
    expect(langFromHl('en')).toBe('en');
    expect(langFromHl('vi')).toBe('en');
  });
  it('F-04-AC1 gives nothing when YouTube does not say', () => {
    expect(langFromHl('')).toBeUndefined();
    expect(langFromHl(null)).toBeUndefined();
  });
});

describe('hlFromPrefCookie', () => {
  it('F-04-AC1 reads hl from the PREF cookie', () => {
    expect(hlFromPrefCookie('VISITOR_INFO1_LIVE=x; PREF=f6=40000000&hl=zh-CN&tz=Asia.Shanghai; YSC=y')).toBe('zh-CN');
    expect(hlFromPrefCookie('PREF=hl%3Dvi%26f5%3D30000')).toBe('vi');
  });
  it('gives nothing without PREF or hl', () => {
    expect(hlFromPrefCookie('YSC=y')).toBeUndefined();
    expect(hlFromPrefCookie('PREF=f6=40000000')).toBeUndefined();
  });
});
