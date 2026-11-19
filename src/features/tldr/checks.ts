// TL;DR self-checks (design §15), run in the service worker.

import type { SelfCheck } from '@/core/selfcheck';
import { GeminiError } from './client';
import { PENDING_DELETES_KEY } from './provider';
import type { TldrService } from './service';

const FIX_LOGIN = '登录 gemini.google.com（账号编号要和设置里的 N 一致），并且不要屏蔽第三方 cookie（chrome://settings/cookies）';
const FIX_APP = '开启 Gemini 应用活动记录（https://myactivity.google.com/product/gemini），并在 https://gemini.google.com/apps 启用 YouTube 应用';

export function tldrChecks(svc: TldrService): SelfCheck[] {
  let tokensOk = false;
  let deleteOk: boolean | undefined;
  return [
    {
      feature: 'tldr',
      name: '能拿到 Gemini 的 SNlM0e（已登录）',
      async run() {
        try {
          await svc.client.tokens();
          tokensOk = true;
          return { status: 'pass' };
        } catch (e) {
          tokensOk = false;
          if (e instanceof GeminiError && e.error.code === 'auth') return { status: 'fail', detail: `未登录 Gemini，或者第三方 cookie 被屏蔽。修复：${FIX_LOGIN}` };
          if (e instanceof GeminiError && e.error.code === 'protocol') return { status: 'pass', detail: '拿到了 SNlM0e' };
          return { status: 'fail', detail: String(e instanceof Error ? e.message : e) };
        }
      },
    },
    {
      feature: 'tldr',
      name: '能提取 bl 和 f.sid',
      async run() {
        if (!tokensOk) return { status: 'skip', detail: '上一项没通过' };
        try {
          await svc.client.tokens();
          return { status: 'pass' };
        } catch (e) {
          return { status: 'fail', detail: `提取不到，协议可能变了：${String(e)}` };
        }
      },
    },
    {
      feature: 'tldr',
      name: '实际总结一个有字幕的短视频',
      async run() {
        if (!tokensOk) return { status: 'skip', detail: '没登录 Gemini' };
        if (svc.isPaused()) return { status: 'skip', detail: '熔断中（额度或风控），恢复后再试' };
        const before = ((await browser.storage.local.get(PENDING_DELETES_KEY))[PENDING_DELETES_KEY] as string[] | undefined)?.length ?? 0;
        const r = await svc.provider.summarize({ videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', lang: 'auto', titleCheck: true });
        const after = ((await browser.storage.local.get(PENDING_DELETES_KEY))[PENDING_DELETES_KEY] as string[] | undefined)?.length ?? 0;
        deleteOk = after <= before;
        if (r.kind === 'ok' && r.data.points.length) return { status: 'pass', detail: r.data.points[0] };
        if (r.kind === 'ok') return { status: 'fail', detail: `回答不是 JSON：${(r.data.raw ?? '').slice(0, 80)}` };
        if (r.kind === 'unreadable') return { status: 'fail', detail: `读不到视频。修复：${FIX_APP}` };
        return { status: 'fail', detail: `${r.error.code}: ${r.detail ?? ''}` };
      },
    },
    {
      feature: 'tldr',
      name: '删除对话成功',
      async run() {
        if (deleteOk === undefined) return { status: 'skip', detail: '上一项没有跑' };
        return deleteOk ? { status: 'pass' } : { status: 'fail', detail: '删除失败，已存进待删列表，空闲时会重试' };
      },
    },
  ];
}
