import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '@/features/danmaku/params';
import { isToc, stampTimes } from '@/features/danmaku/stamps';
import { comment } from './helpers';

const P = DEFAULT_PARAMS.stamps;
const toc = (text: string) => isToc(comment(text), P, DEFAULT_PARAMS.display.cjkWidth);

describe('isToc', () => {
  it('accepts time + short title lines starting at 0:00', () => {
    expect(toc('0:00 Intro\n1:20 - The setup\n3:05 First test\n5:40 | Second test\n8:12 Results')).toBe(true);
  });

  it('allows an intro line, titles before the time and ranges', () => {
    expect(toc('Chapters:\n\nIntro 0:00\nPart one 1:00-2:30\nPart two 2:30\nPart three 4:10\nOutro 9:59')).toBe(true);
  });

  it('measures Chinese titles by width', () => {
    expect(toc('0:00 开场\n1:20 第一组：豌豆迫击炮\n3:05 西西弗斯\n5:40 弹弓\n8:12 决赛')).toBe(true);
    const long = '这是一个非常非常长的标题，长到超过了目录标题应该有的长度，所以不算目录';
    expect(toc(`0:00 开场\n1:20 ${long}\n3:05 西西弗斯\n5:40 弹弓\n8:12 决赛`)).toBe(false);
  });

  it('rejects lists that do not start at 0:00 or are too short', () => {
    expect(toc('0:05 Intro\n1:20 a\n3:05 b\n5:40 c\n8:12 d')).toBe(false);
    expect(toc('0:00 Intro\n1:20 a\n3:05 b\n5:40 c')).toBe(false);
  });

  it('rejects a highlights list with commentary', () => {
    expect(toc('0:00 lol\n1:20 when he dropped the dish and everyone in the room just froze for a second\n3:05 b\n5:40 c\n8:12 d')).toBe(false);
  });

  it('rejects a line with more than a range', () => {
    expect(toc('0:00 Intro\n1:00 2:00 3:00 bits\n4:05 b\n5:40 c\n8:12 d')).toBe(false);
  });
});

describe('stampTimes', () => {
  it('keeps each moment once, inside the video, in order', () => {
    expect(stampTimes(comment('5:00 and 1:00 and 5:00 again, then 9:59'), 400)).toEqual([60, 300]);
  });
});
