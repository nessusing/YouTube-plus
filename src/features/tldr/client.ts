// GeminiWebClient (F-03-AC13): the only module that knows the protocol.
// Runs in the service worker; cookies come from the browser (credentials:
// 'include'); never rotates cookies.
//
// Two channels to the same backend (F-03-AC7): processSession, which the
// web app has been moving to since 2026-10, and the older StreamGenerate.
// processSession goes first; when a channel fails in a way the other might not
// (protocol / auth), the other is tried, and whichever answered goes first next time.

import type { Logger } from '@/core/log';
import {
  buildInner, CHANNEL_CLOSE, CHANNEL_URL, channelHeaders, channelOpen, channelPrompt, channelSid, classifyChannel,
  extractTokens, mapChannelStatus, mapErrorCode, mapHttpStatus, parseChannel, parseStream, sapisidHash, splitChannelFrames,
  type Parsed,
} from './protocol';
import type { ProviderError } from './types';

export class GeminiError extends Error {
  constructor(public error: ProviderError, message: string) {
    super(message);
  }
}

const BASE = 'https://gemini.google.com';

export interface Tokens { at: string; bl: string; sid: string; key?: string }

export type Channel = 'processSession' | 'StreamGenerate';

/** Failures worth trying the other channel for. Quota and blocks are per account, not per channel. */
const SWITCH_ON: ReadonlySet<ProviderError['code']> = new Set(['protocol', 'auth']);

/** Upstream ofs=1 goes this long after the ack (sent at once, most attempts got no answer: zexadev). */
const PROMPT_GAP_MS = 500;
/** Send the prompt anyway if no ack arrives. */
const ACK_WAIT_MS = 3000;
/** No answer frame by then: treat the channel as broken so the other one gets a turn. */
const FIRST_ANSWER_MS = 20_000;
const SESSION_MS = 180_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const zx = () => Math.random().toString(36).slice(2, 14);

export class GeminiWebClient {
  private reqid = 10000 + Math.floor(Math.random() * 90000);
  private order: Channel[] = ['processSession', 'StreamGenerate'];
  /** The channel that produced the last answer (for the self-check). */
  lastChannel: Channel | undefined;

  constructor(private account: () => number, private log?: Logger) {}

  private prefix(): string {
    return `/u/${this.account()}`;
  }

  /** Fresh tokens from the app page every time (bl expires; F-03). */
  async tokens(): Promise<Tokens> {
    const res = await fetch(`${BASE}${this.prefix()}/app`, { credentials: 'include' });
    if (!res.ok) throw new GeminiError(mapHttpStatus(res.status), `app page: HTTP ${res.status}`);
    const t = extractTokens(await res.text());
    if (!t.at) throw new GeminiError({ code: 'auth' }, 'no SNlM0e: not signed in to Gemini, or third-party cookies are blocked');
    if (!t.bl || !t.sid) throw new GeminiError({ code: 'protocol' }, 'no cfb2h / FdrFJe in the app page: the protocol may have changed');
    return { at: t.at, bl: t.bl, sid: t.sid, key: t.key };
  }

  private nextReqid(): number {
    this.reqid += 100000;
    return this.reqid;
  }

  async generate(prompt: string): Promise<Parsed> {
    const tk = await this.tokens();
    const errors: GeminiError[] = [];
    for (const ch of [...this.order]) {
      try {
        const p = ch === 'processSession' ? await this.viaSession(prompt, tk) : await this.viaStream(prompt, tk);
        if (this.order[0] !== ch) {
          this.order = [ch, ...this.order.filter((c) => c !== ch)];
          this.log?.info(`Gemini channel: ${ch} answered, using it first from now on`);
        }
        this.lastChannel = ch;
        return p;
      } catch (e) {
        if (!(e instanceof GeminiError) || !SWITCH_ON.has(e.error.code)) throw e;
        errors.push(e);
        this.log?.warn(`Gemini channel ${ch} failed (${e.error.code}): ${e.message}`);
      }
    }
    // Both failed: an auth error tells the user what to do; otherwise the last one.
    throw errors.find((e) => e.error.code === 'auth') ?? errors.at(-1)!;
  }

  /** Shared checks on a parsed answer. */
  private finish(p: Parsed, ch: Channel, size: number): Parsed {
    if (p.errorCode) throw new GeminiError(mapErrorCode(p.errorCode), `${ch}: BardErrorInfo ${p.errorCode}`);
    if (!p.text) throw new GeminiError({ code: 'protocol' }, `${ch}: no answer text in ${size} bytes`);
    return p;
  }

  private async viaStream(prompt: string, tk: Tokens): Promise<Parsed> {
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
    return this.finish(parseStream(raw), 'StreamGenerate', raw.length);
  }

  /**
   * processSession (F-03-AC7): handshake, a long-poll GET for downstream,
   * and three upstream POSTs: the request without the prompt, the prompt once
   * the server acks, and "done" once the answer is complete.
   */
  private async viaSession(prompt: string, tk: Tokens): Promise<Parsed> {
    if (!tk.key) throw new GeminiError({ code: 'protocol' }, 'processSession: no d2zJAe in the app page');
    const authorization = await sapisidHash(await readSapisid(), Math.floor(Date.now() / 1000));
    const ac = new AbortController();
    const fail = (e: unknown) => {
      if (!ac.signal.aborted) ac.abort(e instanceof GeminiError ? e : new GeminiError({ code: 'transient' }, `processSession: ${String(e)}`));
    };
    const timers = [
      setTimeout(() => fail(new GeminiError({ code: 'protocol' }, `processSession: no answer in ${SESSION_MS / 1000} s`)), SESSION_MS),
    ];
    const send = async (url: string, body?: string): Promise<Response> => {
      try {
        return await fetch(url, {
          method: body === undefined ? 'GET' : 'POST',
          credentials: 'include',
          signal: ac.signal,
          ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }),
        });
      } catch (e) {
        throw aborted(ac) ?? new GeminiError({ code: 'transient' }, `processSession network: ${String(e)}`);
      }
    };
    try {
      let rid = 10000 + Math.floor(Math.random() * 80000);
      const hs = await send(`${CHANNEL_URL}?VER=8&RID=${rid++}&CVER=22&X-HTTP-Session-Id=gsessionid`
        + `&$httpHeaders=${encodeURIComponent(channelHeaders(tk.key, authorization, this.account()))}&zx=${zx()}&t=1`, 'count=0');
      const hsBody = await hs.text();
      if (!hs.ok) throw new GeminiError(sessionHttp(hs.status), `processSession handshake: HTTP ${hs.status}`);
      const sid = channelSid(hsBody);
      const gsid = hs.headers.get('X-HTTP-Session-Id');
      if (!sid || !gsid) throw new GeminiError({ code: 'protocol' }, 'processSession handshake: no session id');
      const sess = `gsessionid=${encodeURIComponent(gsid)}&SID=${encodeURIComponent(sid)}`;

      let aid = 0;
      const post = async (ofs: number, data: unknown) => {
        const r = await send(`${CHANNEL_URL}?VER=8&${sess}&RID=${rid++}&AID=${aid}&zx=${zx()}&t=1`,
          `count=1&ofs=${ofs}&req0___data__=${encodeURIComponent(JSON.stringify(data))}`);
        await r.text();
        if (!r.ok) throw new GeminiError(sessionHttp(r.status), `processSession ofs=${ofs}: HTTP ${r.status}`);
      };
      let promptSent: Promise<void> | undefined;
      const sendPrompt = () => {
        promptSent ??= sleep(PROMPT_GAP_MS).then(() => post(1, channelPrompt(prompt)));
        promptSent.catch(fail);
      };
      const uuid = crypto.randomUUID();
      const answers: unknown[] = [];
      let raw = '';
      let opened = false;
      let closing = false;

      // Downstream: the server drops the GET after ~60 s idle; reconnect with the last id seen.
      for (;;) {
        const g = await send(`${CHANNEL_URL}?${sess}&VER=8&RID=rpc&AID=${aid}&CI=0&TYPE=xmlhttp&zx=${zx()}&t=1`);
        if (!g.ok || !g.body) throw new GeminiError(sessionHttp(g.status), `processSession downstream: HTTP ${g.status}`);
        if (!opened) {
          // The ack for ofs=0 comes on the downstream, so open it first.
          opened = true;
          post(0, channelOpen(uuid)).then(() => timers.push(setTimeout(sendPrompt, ACK_WAIT_MS)), fail);
          timers.push(setTimeout(() => {
            if (!answers.length) fail(new GeminiError({ code: 'protocol' }, `processSession: no answer frame in ${FIRST_ANSWER_MS / 1000} s`));
          }, FIRST_ANSWER_MS));
        }
        const reader = g.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          let chunk: ReadableStreamReadResult<string>;
          try {
            chunk = await reader.read();
          } catch (e) {
            throw aborted(ac) ?? new GeminiError({ code: 'transient' }, `processSession read: ${String(e)}`);
          }
          if (chunk.done) break;
          buf += chunk.value;
          const { items, rest } = splitChannelFrames(buf);
          buf = rest;
          for (const [id, payload] of items) {
            aid = Math.max(aid, id);
            const ev = classifyChannel(payload);
            if (ev.kind === 'error') throw new GeminiError(mapChannelStatus(ev.status), `processSession status ${ev.status}: ${ev.message}`);
            if (ev.kind === 'ack') sendPrompt();
            if (ev.kind === 'content') {
              if (ev.answer != null) {
                answers.push(ev.answer);
                raw += JSON.stringify(ev.answer);
              }
              if (ev.done && !closing) {
                closing = true;
                post(2, CHANNEL_CLOSE).catch(fail);
              }
            }
            if (ev.kind === 'end') {
              void reader.cancel().catch(() => {});
              return this.finish(parseChannel(answers, raw), 'processSession', raw.length);
            }
          }
        }
        if (ac.signal.aborted) throw aborted(ac)!;
      }
    } finally {
      for (const t of timers) clearTimeout(t);
      if (!ac.signal.aborted) ac.abort();
    }
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

/** The error a channel was aborted with (timeout or a failed upstream POST), if any. */
function aborted(ac: AbortController): GeminiError | undefined {
  return ac.signal.aborted && ac.signal.reason instanceof GeminiError ? ac.signal.reason : undefined;
}

/** HTTP errors on the new host: 400 there means a request it no longer takes, not a sign-in problem. */
function sessionHttp(status: number): ProviderError {
  if (status === 401 || status === 403) return { code: 'auth' };
  if (status === 429) return { code: 'blocked' };
  if (status >= 500) return { code: 'transient' };
  return { code: 'protocol' };
}

/** SAPISID signs the session; without it the server answers as an anonymous user. */
async function readSapisid(): Promise<string> {
  if (!browser.cookies) throw new GeminiError({ code: 'auth' }, 'processSession: no cookies permission');
  const c = await browser.cookies.get({ url: BASE, name: 'SAPISID' });
  if (!c?.value) throw new GeminiError({ code: 'auth' }, 'processSession: no SAPISID cookie (not signed in to Google)');
  return c.value;
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
        requestDomains: ['gemini.google.com', 'geminiweb-pa.clients6.google.com'],
        initiatorDomains: [browser.runtime.id],
        resourceTypes: ['xmlhttprequest'],
      },
    }],
  });
}
