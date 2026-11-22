// The extension's language is YouTube's interface language (design §2 "follow
// the official site", plans P23): there is no language setting of our own.
// Every YouTube page reports what it is shown in; settings.lang stores it and
// initLang() makes every context follow. Before YouTube has been opened once,
// settings.lang falls back to the browser language (detectLang).

import { getSettings, saveSettings, type Lang } from './settings';

/** YouTube's `hl` ("zh-Hans-CN", "zh-TW", "en", "vi"…) → one of our two languages. Traditional counts as Chinese. */
export function langFromHl(hl: string | null | undefined): Lang | undefined {
  if (!hl) return undefined;
  return /^zh\b/i.test(hl) ? 'zh' : 'en';
}

/** `hl` from the PREF cookie (`…&hl=zh-CN&…`), used when `<html lang>` is missing. */
export function hlFromPrefCookie(cookie: string): string | undefined {
  const pref = /(?:^|;\s*)PREF=([^;]*)/.exec(cookie)?.[1];
  return pref ? /(?:^|&)hl=([^&]*)/.exec(decodeURIComponent(pref))?.[1] : undefined;
}

/** Read this YouTube page's language and store it if it changed. */
export async function syncLangFromYouTube(): Promise<void> {
  const l = langFromHl(document.documentElement.lang) ?? langFromHl(hlFromPrefCookie(document.cookie));
  if (!l) return;
  const s = await getSettings();
  if (s.lang === l) return;
  s.lang = l;
  await saveSettings(s);
}
