// Theater-mode auto switching while the sticky player is on (design §36.2,
// §36.3). Pure state machine; the DOM side feeds it events and performs the
// actions it returns.

export type TheaterAction = 'toNormal' | 'toTheater' | 'scrollTop' | 'none';

/** Ignore scroll events caused by our own switch for this long. */
export const SUPPRESS_MS = 400;

export class TheaterMachine {
  /** True while we are the reason the page is in normal mode. */
  autoSwitched = false;
  /** The theater value we are waiting to see after our own click, if any. */
  private expecting: boolean | undefined;
  private suppressUntil = 0;

  onScroll(y: number, theater: boolean, now: number): TheaterAction {
    if (now < this.suppressUntil || this.expecting !== undefined) return 'none';
    if (theater && y > 0) return this.start(false, now);
    if (!theater && this.autoSwitched && y <= 0) return this.start(true, now);
    return 'none';
  }

  private start(toTheater: boolean, now: number): TheaterAction {
    this.expecting = toTheater;
    this.suppressUntil = now + SUPPRESS_MS;
    this.autoSwitched = !toTheater;
    return toTheater ? 'toTheater' : 'toNormal';
  }

  /** The page's theater value changed (ours or the user's). */
  onTheaterChanged(theater: boolean, y: number, now: number): TheaterAction {
    if (this.expecting === theater) {
      this.expecting = undefined;
      this.suppressUntil = now + SUPPRESS_MS;
      return 'none';
    }
    // The user switched (t key or the button): stop auto switching back.
    this.expecting = undefined;
    this.autoSwitched = false;
    // Into theater while scrolled down: they want the big picture (§36.3).
    if (theater && y > 0) {
      this.suppressUntil = now + SUPPRESS_MS;
      return 'scrollTop';
    }
    return 'none';
  }

  /** Our click did not take effect (no button, etc.). */
  abort(): void {
    this.expecting = undefined;
    this.autoSwitched = false;
  }

  /** New video or left the watch page. */
  reset(): void {
    this.autoSwitched = false;
    this.expecting = undefined;
    this.suppressUntil = 0;
  }
}

/** Parse a YouTube t= value: "90", "90s", "1m30s", "1h2m3s". */
export function parseT(t: string | null): number | undefined {
  if (!t) return undefined;
  if (/^\d+s?$/.test(t)) return parseInt(t, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
