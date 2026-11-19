// Self-check framework (docs/design.md §5). Each feature registers its own
// checks; the runner runs those of enabled features in order and logs results.

import type { LogFeature, Logger } from './log';

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckOutcome {
  status: CheckStatus;
  /** Shown to the user: what went wrong and how to fix it, or why it was skipped. */
  detail?: string;
}

export interface SelfCheck {
  feature: LogFeature;
  name: string;
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
    const r = { feature: c.feature, name: c.name, ...outcome };
    results.push(r);
    const line = `self-check [${c.feature}] ${c.name}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`;
    if (r.status === 'fail') log.warn(line);
    else log.info(line);
  }
  return results;
}
