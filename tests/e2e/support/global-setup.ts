// Before any test: stop at once if another Chromium holds the signed-in
// profile (another e2e run, or e2e:login left open). Otherwise every test
// fails on its own launch with the same ProcessSingleton error.

import { readlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { PROFILE_DIR } from './env';

/** The pid in PROFILE_DIR/SingletonLock (a symlink to `<host>-<pid>`) if it is alive on this host. */
function lockHolder(): number | undefined {
  let target: string;
  try {
    target = readlinkSync(join(PROFILE_DIR, 'SingletonLock'));
  } catch {
    return undefined; // no lock
  }
  const m = /^(.*)-(\d+)$/.exec(target);
  if (!m || m[1] !== hostname()) return undefined;
  const pid = Number(m[2]);
  try {
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    // EPERM: alive but someone else's; ESRCH: a stale lock Chromium takes over.
    return (e as NodeJS.ErrnoException).code === 'EPERM' ? pid : undefined;
  }
}

export default function globalSetup(): void {
  const pid = lockHolder();
  if (pid !== undefined) {
    throw new Error(`e2e profile ${PROFILE_DIR} is in use by pid ${pid} (another e2e run, or e2e:login still open); stop it first`);
  }
}
