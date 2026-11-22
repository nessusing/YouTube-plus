// Self-check framework (docs/design.md §5). Each feature registers its own
// checks; the runner runs those of enabled features in order and logs results.

import { t, type MsgKey } from './i18n';
import type { LogFeature, Logger } from './log';

/** warn: works, but something is missing that the user should know about (yellow, not a failure). */
export type CheckStatus = 'pass' | 'fail' | 'skip' | 'warn';

export interface CheckOutcome {
  status: CheckStatus;
  /** Shown to the user: what went wrong and how to fix it, or why it was skipped. */
  detail?: string;
}

export interface SelfCheck {
  feature: LogFeature;
  /** i18n key; also the id page checks are looked up by */
  name: MsgKey;
  run(): Promise<CheckOutcome>;
}

export interface CheckResult extends CheckOutcome {
  feature: LogFeature;
  name: string;
}

export async function runChecks(
  checks: SelfCheck[],
  isEnabled: (f: LogFeature) => boolean,
  log: Logger,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const c of checks) {
    if (!isEnabled(c.feature)) continue;
    let outcome: CheckOutcome;
    try {
      outcome = await c.run();
    } catch (e) {
      outcome = { status: 'fail', detail: e instanceof Error ? e.message : String(e) };
    }
    const r = { feature: c.feature, name: t(c.name), ...outcome };
    results.push(r);
    const line = `self-check [${c.feature}] ${c.name}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`;
    if (r.status === 'fail' || r.status === 'warn') log.warn(line);
    else log.info(line);
  }
  return results;
}
