import type { Comment, Stamp } from '@/features/danmaku/comments';

/** A comment whose timestamps are found in the text ("m:ss" written in it). */
export function comment(text: string, more: Partial<Comment> = {}): Comment {
  const stamps: Stamp[] = [];
  for (const m of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) stamps.push({ sec: Number(m[1]) * 60 + Number(m[2]), start: m.index, len: m[0].length });
  return { id: text, text, author: '@someone', likes: 0, replies: 0, ageDays: null, stamps, images: [], hasLink: false, ...more };
}
