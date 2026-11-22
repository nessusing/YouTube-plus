// Text measures shared by filtering, timing and table-of-contents detection (plans P13).

/** Chinese, Japanese and Korean letters: slower to read, about twice as wide. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** Full-width punctuation and forms: as wide as CJK, read like punctuation. */
const WIDE_PUNCT = /[　-〿＀-￯]/u;

export const isCjk = (ch: string): boolean => CJK.test(ch);
const isWide = (ch: string): boolean => CJK.test(ch) || WIDE_PUNCT.test(ch);

/** Length in Latin characters, a CJK letter counting `cjkWeight` (the "too short" rule). */
export function weightedLength(s: string, cjkWeight: number): number {
  let n = 0;
  for (const ch of s) n += isCjk(ch) ? cjkWeight : 1;
  return n;
}

/** Display width in Latin characters, a CJK letter or full-width mark counting `cjkWidth`. */
export function displayWidth(s: string, cjkWidth: number): number {
  let n = 0;
  for (const ch of s) n += isWide(ch) ? cjkWidth : 1;
  return n;
}

/** Remove [start, start + len) ranges (UTF-16, as YouTube's runs give them; verified 2026-11-22). */
export function cutRanges(s: string, ranges: { start: number; len: number }[]): string {
  let out = '';
  let at = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start < at) continue;
    out += s.slice(at, r.start);
    at = r.start + r.len;
  }
  return out + s.slice(at);
}

const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣]/gu;
/** YouTube custom emoji left as text, e.g. ":face-blue-smiling:". */
const SHORTCODE = /:[a-z0-9_-]+:/gi;

/** Letters and digits only, lower case: for "pure emoji" and duplicate checks. */
export function core(s: string): string {
  return s.replace(SHORTCODE, '').replace(EMOJI, '').replace(/[\p{P}\p{S}\p{Z}\s]/gu, '').toLowerCase();
}
