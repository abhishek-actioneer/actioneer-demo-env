/**
 * judge-consistency.ts — offline judge reliability primitive (U6 / R14).
 *
 * `passAtK` characterizes an LLM judge's CONSISTENCY over a fixed fixture set by
 * running the judge k times on the same input and asking: did every run agree?
 *
 * This is an OFFLINE measurement (KTD8), run over advisor-009's regression
 * fixtures to surface each judge's reliability in the U9 dashboard. It is NOT a
 * per-call runtime gate — at runtime each judge runs exactly once, so we never
 * multiply enrichment cost by k.
 *
 * Semantics are strict-consensus: `passK` is true only if ALL k runs passed.
 * A single dissenting run flips it to false. `passRate` is the mean agreement.
 */

export interface PassAtKResult {
  /** True only if every run passed (strict consensus). */
  passK: boolean;
  /** Mean of the boolean runs in [0, 1]. Empty input → 0. */
  passRate: number;
}

/**
 * Compute pass^k over a set of boolean judge outcomes (one per run).
 *
 * - `[true, true, true]`  → `{ passK: true,  passRate: 1 }`
 * - `[true, false, true]` → `{ passK: false, passRate: 0.667 }`
 * - `[]`                  → `{ passK: false, passRate: 0 }`  (explicit empty case)
 */
export function passAtK(results: boolean[]): PassAtKResult {
  if (results.length === 0) return { passK: false, passRate: 0 };
  const passes = results.reduce((n, r) => n + (r ? 1 : 0), 0);
  return {
    passK: passes === results.length,
    passRate: passes / results.length,
  };
}
