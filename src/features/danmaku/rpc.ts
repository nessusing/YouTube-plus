// Isolated-world client for the danmaku MAIN world script.

import { isToIso, TAG, type MainApi } from './bridge';

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };
export type MainRpc = Async<MainApi>;

export function connectMain(timeoutMs = 20000): MainRpc {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  window.addEventListener('message', (e) => {
    if (e.source !== window || !isToIso(e.data)) return;
    const d = e.data;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d.result);
    else p.reject(new Error(d.error));
  });
  const invoke = (method: string, args: unknown[]) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      window.postMessage({ tag: TAG, dir: 'toMain', id, method, args }, location.origin);
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${method}: no answer from the page script`));
      }, timeoutMs);
    });
  return new Proxy({} as MainRpc, { get: (_t, method: string) => (...args: unknown[]) => invoke(method, args) });
}
