// GeminiWebClient (design §9, §10): the only module that knows the protocol.
// Runs in the service worker; cookies come from the browser (credentials:
// 'include'); never rotates cookies.

import { buildInner, extractTokens, mapErrorCode, mapHttpStatus, parseStream, type Parsed } from './protocol';
import type { ProviderError } from './types';

export class GeminiError extends Error {
  constructor(public error: ProviderError, message: string) {
    super(message);
  }
}

const BASE = 'https://gemini.google.com';

export interface Tokens { at: string; bl: string; sid: string }

export class GeminiWebClient {
  private reqid = 10000 + Math.floor(Math.random() * 90000);

  constructor(private account: () => number) {}

  private prefix(): string {
    return `/u/${this.account()}`;
  }

  /** Fresh tokens from the app page every time (bl expires; §10.1). */
  async tokens(): Promise<Tokens> {
    const res = await fetch(`${BASE}${this.prefix()}/app`, { credentials: 'include' });
    if (!res.ok) throw new GeminiError(mapHttpStatus(res.status), `app page: HTTP ${res.status}`);
    const t = extractTokens(await res.text());
    if (!t.at) throw new GeminiError({ code: 'auth' }, 'no SNlM0e: not signed in to Gemini, or third-party cookies are blocked');
    if (!t.bl || !t.sid) throw new GeminiError({ code: 'protocol' }, 'no cfb2h / FdrFJe in the app page: the protocol may have changed');
    return { at: t.at, bl: t.bl, sid: t.sid };
  }

  private nextReqid(): number {
    this.reqid += 100000;
    return this.reqid;
  }

  async generate(prompt: string): Promise<Parsed> {
    const tk = await this.tokens();
    const uuid = crypto.randomUUID();
    const body = new URLSearchParams({ at: tk.at, 'f.req': JSON.stringify([null, JSON.stringify(buildInner(prompt, uuid))]) });
    const url = `${BASE}${this.prefix()}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`
      + `?bl=${encodeURIComponent(tk.bl)}&f.sid=${encodeURIComponent(tk.sid)}&hl=en&_reqid=${this.nextReqid()}&rt=c`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
          'X-Same-Domain': '1',
          'x-goog-ext-525005358-jspb': JSON.stringify([uuid, 1]),
        },
        body,
      });
    } catch (e) {
      throw new GeminiError({ code: 'transient' }, `network: ${String(e)}`);
    }
    const raw = await res.text();
    if (!res.ok) throw new GeminiError(mapHttpStatus(res.status), `StreamGenerate: HTTP ${res.status}`);
    if (/captcha|unusual traffic/i.test(raw.slice(0, 2000))) throw new GeminiError({ code: 'blocked' }, 'captcha / unusual traffic page');
    const p = parseStream(raw);
    if (p.errorCode) throw new GeminiError(mapErrorCode(p.errorCode), `BardErrorInfo ${p.errorCode}`);
    if (!p.text) throw new GeminiError({ code: 'protocol' }, `no answer text in ${raw.length} bytes`);
    return p;
  }

  async deleteConversation(cid: string): Promise<void> {
    const tk = await this.tokens();
    const fReq = JSON.stringify([[['GzXR5e', JSON.stringify([cid]), null, 'generic']]]);
    const url = `${BASE}${this.prefix()}/_/BardChatUi/data/batchexecute?rpcids=GzXR5e&source-path=${encodeURIComponent(`${this.prefix()}/app`)}`
      + `&bl=${encodeURIComponent(tk.bl)}&f.sid=${encodeURIComponent(tk.sid)}&hl=en&_reqid=${this.nextReqid()}&rt=c`;
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', 'X-Same-Domain': '1' },
      body: new URLSearchParams({ at: tk.at, 'f.req': fReq }),
    });
    const raw = await res.text();
    if (!res.ok || !raw.includes('"GzXR5e"')) throw new Error(`delete ${cid}: HTTP ${res.status}`);
  }
}

/** Requests from the service worker carry a chrome-extension:// Origin; present them as same-site. */
export async function installHeaderRule(): Promise<void> {
  const id = 1;
  await browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'origin', operation: 'set', value: BASE },
          { header: 'referer', operation: 'set', value: `${BASE}/` },
        ],
      },
      condition: {
        urlFilter: '||gemini.google.com/',
        initiatorDomains: [browser.runtime.id],
        resourceTypes: ['xmlhttprequest'],
      },
    }],
  });
}
