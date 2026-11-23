// Shared log (F-01-AC4). Any context logs through createLogger();
// entries reach the service worker, which batches them into a capped ring
// buffer in chrome.storage.local. Never put cookies or auth headers in here.

import type { FeatureId } from './settings';

export type LogFeature = FeatureId | 'core';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface LogEntry {
  t: number;
  feature: LogFeature;
  level: LogLevel;
  msg: string;
}

export const LOG_KEY = 'log';

/** Rough serialized size of one entry; good enough for the 2 MB cap. */
export function entrySize(e: LogEntry): number {
  // {"t":1763000000000,"feature":"","level":"","msg":""} is about 55 chars of overhead.
  return e.msg.length + e.feature.length + e.level.length + 60;
}

/** Append and drop the oldest entries until the byte cap holds. Pure. */
export function appendCapped(existing: LogEntry[], incoming: LogEntry[], maxBytes: number): LogEntry[] {
  const all = existing.concat(incoming);
  let start = 0;
  let bytes = 0;
  for (const e of all) bytes += entrySize(e);
  while (start < all.length && bytes > maxBytes) bytes -= entrySize(all[start++]!);
  return start === 0 ? all : all.slice(start);
}

export function formatEntry(e: LogEntry): string {
  const d = new Date(e.t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  return `${ts} [${e.feature}] ${e.level.toUpperCase()} ${e.msg}`;
}

export function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

export type LogSink = (entries: LogEntry[]) => void;

let sink: LogSink = (entries) => {
  browser.runtime.sendMessage({ type: 'YouTube+/log', entries }).catch(() => {
    // Extension reloaded or worker unreachable: nothing sensible to do.
  });
};

/** The service worker swaps in a direct sink so it does not message itself. */
export function setLogSink(s: LogSink): void {
  sink = s;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(feature: LogFeature): Logger {
  const make = (level: LogLevel) => (...args: unknown[]) => {
    const msg = args.map(stringifyArg).join(' ');
    try {
      sink([{ t: Date.now(), feature, level, msg }]);
    } catch {
      // Logging must never throw into feature code.
    }
    if (level === 'error' || level === 'warn') console[level](`[YouTube+ ${feature}]`, ...args);
  };
  return { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') };
}
