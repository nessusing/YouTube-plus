// TL;DR self-checks (design §15), run in the service worker.

import { getLang, t } from '@/core/i18n';
import type { SelfCheck } from '@/core/selfcheck';
import { GeminiError } from './client';
import { PENDING_DELETES_KEY } from './provider';
import type { TldrService } from './service';

export function tldrChecks(svc: TldrService): SelfCheck[] {
  let tokensOk = false;
  let deleteOk: boolean | undefined;
  return [
    {
      feature: 'tldr',
      name: 'check.tldr.login',
      async run() {
        try {
          await svc.client.tokens();
          tokensOk = true;
          return { status: 'pass' };
        } catch (e) {
          tokensOk = false;
          if (e instanceof GeminiError && e.error.code === 'auth') return { status: 'fail', detail: t('check.tldr.loginFail') };
          if (e instanceof GeminiError && e.error.code === 'protocol') return { status: 'pass', detail: t('check.tldr.gotToken') };
          return { status: 'fail', detail: String(e instanceof Error ? e.message : e) };
        }
      },
    },
    {
      feature: 'tldr',
      name: 'check.tldr.tokens',
      async run() {
        if (!tokensOk) return { status: 'skip', detail: t('check.prevFailed') };
        try {
          await svc.client.tokens();
          return { status: 'pass' };
        } catch (e) {
          return { status: 'fail', detail: t('check.tldr.tokensFail', { e: String(e) }) };
        }
      },
    },
    {
      feature: 'tldr',
      name: 'check.tldr.summarize',
      async run() {
        if (!tokensOk) return { status: 'skip', detail: t('check.tldr.notLoggedIn') };
        if (svc.isPaused()) return { status: 'skip', detail: t('check.tldr.paused') };
        const before = ((await browser.storage.local.get(PENDING_DELETES_KEY))[PENDING_DELETES_KEY] as string[] | undefined)?.length ?? 0;
        const r = await svc.provider.summarize({ videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', lang: getLang(), titleCheck: true });
        const after = ((await browser.storage.local.get(PENDING_DELETES_KEY))[PENDING_DELETES_KEY] as string[] | undefined)?.length ?? 0;
        deleteOk = after <= before;
        if (r.kind === 'ok' && r.data.points.length) return { status: 'pass', detail: `[${svc.client.lastChannel}] ${r.data.points[0]}` };
        if (r.kind === 'ok') return { status: 'fail', detail: t('check.tldr.notJson', { s: (r.data.raw ?? '').slice(0, 80) }) };
        if (r.kind === 'unreadable') return { status: 'fail', detail: t('check.tldr.unreadable') };
        return { status: 'fail', detail: `${r.error.code}: ${r.detail ?? ''}` };
      },
    },
    {
      feature: 'tldr',
      name: 'check.tldr.delete',
      async run() {
        if (deleteOk === undefined) return { status: 'skip', detail: t('check.prevNotRun') };
        return deleteOk ? { status: 'pass' } : { status: 'fail', detail: t('check.tldr.deleteFail') };
      },
    },
  ];
}
