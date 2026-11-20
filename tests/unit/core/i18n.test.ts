import { describe, expect, it } from 'vitest';
import { setLang, t } from '@/core/i18n';
import { withDefaults } from '@/core/settings';

describe('t', () => {
  it('follows the current language and fills in variables', () => {
    setLang('zh');
    expect(t('verdict.match')).toBe('标题相符');
    expect(t('queue.deleted', { n: 3 })).toBe('已删除 3 个');
    setLang('en');
    expect(t('verdict.match')).toBe('Title matches');
    expect(t('queue.confirmRemove', { n: 2, title: 'L' })).toBe('Remove 2 videos from "L"');
  });
});

describe('settings.lang', () => {
  it('keeps a stored language and replaces unknown ones', () => {
    expect(withDefaults({ lang: 'zh' }).lang).toBe('zh');
    expect(['en', 'zh']).toContain(withDefaults({ lang: 'fr' as never }).lang);
  });
});
