// Sample cards for the options page preview (F-12, avatars F-19-AC3). Fixed comments of
// every shape (short, long, CJK, rotating, contents); durations follow the
// current params, like the real schedule.

import { durOf } from './cards';
import type { Comment } from './comments';
import type { DanmakuParams } from './params';
import type { Slot, SlotKind } from './schedule';

/** Colours for the sample avatars. */
const AVATAR_BG = ['#5c6bc0', '#26a69a', '#ef6c00', '#ab47bc', '#8d6e63', '#42a5f5', '#d81b60'];

/**
 * A sample avatar (F-19-AC3): a coloured circle with the handle's first letter,
 * like YouTube's default avatars; inline, so the settings page needs no network.
 */
export function letterAvatar(author: string): string {
  const letter = [...author.replace(/^@/, '')][0]?.toUpperCase() ?? '?';
  let h = 0;
  for (const ch of author) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${AVATAR_BG[h % AVATAR_BG.length]}"/>`
    + `<text x="20" y="27" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-size="20" fill="#fff">${letter.replace(/[<>&]/g, '')}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const c = (id: string, author: string, text: string, likes = 0): Comment => ({
  id: `demo-${id}`, text, author, likes, replies: 0, ageDays: null, stamps: [], images: [], hasLink: false, avatar: letterAvatar(author),
});

const CARDS: { kind: SlotKind; items: Comment[]; extra?: number; conf?: number }[] = [
  { kind: 'stamp', items: [c('1', '@spacefan', '1:02 Never thought a crater could look this beautiful.')] },
  { kind: 'local', items: [c('2', '@小明同学', '这一段的配乐太好听了，有人知道叫什么吗？')] },
  {
    kind: 'ai', conf: 0.95,
    items: [c('3', '@longreader', 'I love that these astronauts were so excited about lunar geology. The program was not designed for scientists to be the astronauts, but the people they chose were just the right sort to understand why rocks are exciting, and you can hear it in their voices when they find what they came for.')],
  },
  {
    kind: 'stamp', extra: 4,
    items: [c('4a', '@阿杰', '2:35 哈哈哈哈这个表情太绝了', 50), c('4b', '@maria', '2:36 the face he made 😂', 30), c('4c', '@路人甲', '2:37 我笑到邻居来敲门', 12)],
  },
  {
    kind: 'ambient',
    items: [c('5', '@老观众', '看了这么多年，还是觉得这种不追热点、认认真真把一件事讲清楚的视频最难得。每次看完都想再去翻翻资料，谢谢你们一直坚持做下去，也希望更多人能看到这样的内容。')],
  },
  { kind: 'toc', items: [c('6', '@channel', '0:00 开场\n1:20 第一组：豌豆迫击炮\n3:05 第二组：西西弗斯\n5:40 决赛\n8:12 结果')] },
];

/** The sample cards one after another, from 1 s, with the gap between; and the loop length. */
export function demoTimeline(p: DanmakuParams): { slots: Slot[]; length: number } {
  const slots: Slot[] = [];
  let at = 1;
  for (const card of CARDS) {
    const durs = card.items.map((x) => durOf(x, p.display));
    slots.push({ start: at, kind: card.kind, items: card.items, durs, extra: card.extra ?? 0, conf: card.conf });
    at += durs.reduce((a, b) => a + b, 0) + p.display.gapSec;
  }
  return { slots, length: at + 1.5 };
}
