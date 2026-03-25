/**
 * Compute daily usage deltas from snapshot boundaries.
 * Handles window resets (negative deltas) by splitting pre/post reset.
 */
import type { DailyBoundary, DailyDelta } from "../types.js";

/**
 * Process raw daily boundaries into valid daily deltas.
 * - Normal day: delta = lastUsedPct - firstUsedPct
 * - Reset day (delta < 0): split into pre-reset + post-reset consumption
 * - Single-sample day: marked invalid (unknown, not zero)
 */
export function computeDailyDeltas(boundaries: DailyBoundary[]): DailyDelta[] {
  const results: DailyDelta[] = [];

  for (const b of boundaries) {
    // Single-sample days are unknown, not zero
    if (b.sampleCount <= 1) {
      results.push({ date: b.date, delta: 0, valid: false });
      continue;
    }

    const rawDelta = b.lastUsedPct - b.firstUsedPct;

    if (rawDelta >= 0) {
      // Normal day: usage went up
      results.push({ date: b.date, delta: rawDelta, valid: true });
    } else {
      // Negative delta means a window reset occurred mid-day
      if (!b.resetsAt) {
        // No resets_at info, can't split — skip
        results.push({ date: b.date, delta: 0, valid: false });
        continue;
      }

      // Split: pre-reset consumption + post-reset consumption
      // pre_reset = 100 - firstUsedPct (usage consumed before window rolled)
      // post_reset = lastUsedPct (usage consumed in the new window)
      const preReset = 100 - b.firstUsedPct;
      const postReset = b.lastUsedPct;
      const totalDelta = preReset + postReset;

      // If the total seems unreasonable (>100%), likely multiple resets — skip
      if (totalDelta > 100) {
        results.push({ date: b.date, delta: 0, valid: false });
        continue;
      }

      results.push({ date: b.date, delta: totalDelta, valid: true });
    }
  }

  return results;
}
