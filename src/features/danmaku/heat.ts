// How "hot" a comment is (§51.5, used by both modes):
// heat = likeWeight × likes' + replyWeight × replies' + recencyWeight × newness',
// each term normalized to 0–1 over this video's comments.

import type { Comment } from './comments';
import type { HeatParams } from './params';

/** Min-max to 0–1; all equal → all 0. */
function normalize(xs: number[]): number[] {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return hi > lo ? xs.map((x) => (x - lo) / (hi - lo)) : xs.map(() => 0);
}

function boxCox(x: number, lambda: number): number {
  return Math.abs(lambda) < 1e-9 ? Math.log(x) : (x ** lambda - 1) / lambda;
}

/**
 * Box-Cox of positive values with λ fitted by maximum likelihood on a grid
 * (−2…2, step 0.1). Like counts are heavy-tailed; this spreads them out.
 */
export function boxCoxFit(xs: number[]): { lambda: number; ys: number[] } {
  const logSum = xs.reduce((s, x) => s + Math.log(x), 0);
  let best = { lambda: 1, ll: -Infinity };
  for (let i = -20; i <= 20; i++) {
    const lambda = i / 10;
    const ys = xs.map((x) => boxCox(x, lambda));
    const mean = ys.reduce((s, y) => s + y, 0) / ys.length;
    const variance = ys.reduce((s, y) => s + (y - mean) ** 2, 0) / ys.length;
    if (!(variance > 0)) continue;
    const ll = (-xs.length / 2) * Math.log(variance) + (lambda - 1) * logSum;
    if (ll > best.ll) best = { lambda, ll };
  }
  return { lambda: best.lambda, ys: xs.map((x) => boxCox(x, best.lambda)) };
}

/** Heat of each comment, same order. Unknown ages count as the median age. */
export function heatOf(cs: Comment[], p: HeatParams): number[] {
  if (!cs.length) return [];
  const likes = normalize(boxCoxFit(cs.map((c) => c.likes + 1)).ys);
  const replies = normalize(cs.map((c) => Math.log1p(c.replies)));
  const known = cs.map((c) => c.ageDays).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)]! : 0;
  const newness = normalize(cs.map((c) => -Math.log1p(c.ageDays ?? median)));
  return cs.map((_, i) => p.likeWeight * likes[i]! + p.replyWeight * replies[i]! + p.recencyWeight * newness[i]!);
}
