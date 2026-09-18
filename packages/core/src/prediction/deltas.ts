/**
 * Compute daily usage deltas from snapshot boundaries.
 *
 * Consumption is measured as the sum of gains across segments of the day,
 * where a segment ends whenever the value drops sharply (window reset or a
 * provider-side adjustment that zeroes usage mid-window). This replaces the
 * old "assume 100% was reached before a drop" split, which over-counted any
 * day with a mid-window adjustment.
 */
import { USAGE_DROP_RESET_THRESHOLD } from "../constants.js";
import type { DailyBoundary, DailyDelta } from "../types.js";

/**
 * Usage consumed over an ordered run of samples. Gains are summed across
 * segments split wherever the value drops by at least `dropThreshold`; smaller
 * dips are treated as jitter and net out within their segment.
 */
export function consumedFromSamples(samples: number[], dropThreshold: number = USAGE_DROP_RESET_THRESHOLD): number {
  if (samples.length === 0) return 0;

  let consumed = 0;
  let segmentStart = samples[0];
  let prev = samples[0];

  for (let i = 1; i < samples.length; i++) {
    const current = samples[i];
    if (prev - current >= dropThreshold) {
      consumed += Math.max(0, prev - segmentStart);
      segmentStart = current;
    }
    prev = current;
  }

  return consumed + Math.max(0, prev - segmentStart);
}

/**
 * Process raw daily boundaries into valid daily deltas.
 * - Single-sample day: marked invalid (unknown, not zero)
 * - Consumption above 100% in one day: marked invalid (corrupt or multi-reset data)
 * - Otherwise: delta = consumedPct
 */
export function computeDailyDeltas(boundaries: DailyBoundary[]): DailyDelta[] {
  return boundaries.map((b) => {
    if (b.sampleCount <= 1) return { date: b.date, delta: 0, valid: false };
    if (b.consumedPct > 100) return { date: b.date, delta: 0, valid: false };
    return { date: b.date, delta: b.consumedPct, valid: true };
  });
}
