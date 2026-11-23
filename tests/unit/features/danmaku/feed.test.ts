import { describe, expect, it, vi } from 'vitest';
import type { CommentPage } from '@/features/danmaku/comments';
import { ageText, CommentFeed, countText } from '@/features/danmaku/feed';
import type { MainRpc } from '@/features/danmaku/rpc';
import { comment } from './helpers';

function fakeRpc(pages: Record<string, CommentPage>, opts: { token?: string } = { token: 'P1' }) {
  const { token } = opts;
  return {
    video: vi.fn(),
    watch: vi.fn(async () => ({ token, heatmap: [] })),
    page: vi.fn(async (t: string) => {
      const p = pages[t];
      if (!p) throw new Error(`no page ${t}`);
      return p;
    }),
  } as unknown as MainRpc & { watch: ReturnType<typeof vi.fn>; page: ReturnType<typeof vi.fn> };
}

describe('CommentFeed', () => {
  it('F-12-AC14 loads a page per call, keeps YouTube\'s order, skips repeats, stops at the end', async () => {
    const rpc = fakeRpc({
      P1: { comments: [comment('one'), comment('two')], next: 'P2', total: 3 },
      P2: { comments: [comment('two'), comment('three')] },
    });
    const changed = vi.fn();
    const f = new CommentFeed('vid', rpc, changed);
    await f.more();
    expect(f.comments.map((c) => c.text)).toEqual(['one', 'two']);
    expect([f.total, f.done]).toEqual([3, false]);
    await f.more();
    expect(f.comments.map((c) => c.text)).toEqual(['one', 'two', 'three']);
    expect(f.done).toBe(true);
    await f.more();
    expect(rpc.watch).toHaveBeenCalledTimes(1);
    expect(rpc.page).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalled();
  });

  it('F-12-AC14 is done at once without a comments section', async () => {
    const f = new CommentFeed('vid', fakeRpc({}, {}), () => {});
    await f.more();
    expect([f.done, f.comments.length, f.error]).toEqual([true, 0, '']);
  });

  it('F-12-AC14 keeps the error and retries the same page', async () => {
    const pages: Record<string, CommentPage> = {};
    const f = new CommentFeed('vid', fakeRpc(pages), () => {});
    await f.more();
    expect(f.error).toContain('no page P1');
    pages.P1 = { comments: [comment('one')] };
    await f.more();
    expect([f.error, f.comments.length, f.done]).toEqual(['', 1, true]);
  });

  it('F-12-AC14 loads replies page by page as level 1', async () => {
    const rpc = fakeRpc({ R1: { comments: [comment('r1')], next: 'R2' }, R2: { comments: [comment('r2')] } });
    const f = new CommentFeed('vid', rpc, () => {});
    const c = comment('parent', { replies: 2, replyToken: 'R1' });
    await f.moreReplies(c);
    expect(f.replies.get(c.id)).toMatchObject({ next: 'R2', loading: false });
    await f.moreReplies(c);
    expect(f.replies.get(c.id)!.items.map((x) => x.text)).toEqual(['r1', 'r2']);
    expect(f.replies.get(c.id)!.next).toBeUndefined();
    expect(rpc.page).toHaveBeenCalledWith('R1', 'vid', 1);
  });
});

describe('CommentFeed replies of replies', () => {
  it('F-12-AC14 starts from the replies that came inline and loads more one level down', async () => {
    const rpc = fakeRpc({ M: { comments: [comment('s3', { level: 2 })] } });
    const f = new CommentFeed('vid', rpc, () => {});
    const reply = comment('reply', { level: 1, subReplies: [comment('s1', { level: 2 }), comment('s2', { level: 2 })], replyToken: 'M' });
    expect(f.replyState(reply).items.map((x) => x.text)).toEqual(['s1', 's2']);
    await f.moreReplies(reply);
    expect(f.replyState(reply).items.map((x) => x.text)).toEqual(['s1', 's2', 's3']);
    expect(rpc.page).toHaveBeenCalledWith('M', 'vid', 2);
  });
});

describe('ageText', () => {
  it('F-12-AC14 says YouTube\'s English age in the UI language, edited apart', () => {
    expect(ageText('7 years ago (edited)', 'en')).toEqual({ age: '7 years ago', edited: true });
    expect(ageText('1 day ago', 'en')).toEqual({ age: '1 day ago', edited: false });
    expect(ageText('3 months ago', 'zh-CN').age).toBe('3个月前');
  });
  it('F-12-AC14 passes through what it cannot read', () => {
    expect(ageText('Streamed live', 'en')).toEqual({ age: 'Streamed live', edited: false });
  });
});

describe('countText', () => {
  it('F-12-AC14 is compact', () => {
    expect(countText(571000, 'en')).toBe('571K');
    expect(countText(42, 'en')).toBe('42');
    expect(countText(571000, 'zh-CN')).toBe('57.1万');
  });
});
