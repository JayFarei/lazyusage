/**
 * Linear extrapolation projection engine.
 * Projects forward from current usage using average daily consumption rate,
 * with optional supervised mark overrides.
 */
import type { CapacityPrediction, DailyDelta, SupervisedMark } from "../types.js";
import { REGIME_RATES, COLD_START_RATE } from "../constants.js";

/** Format a Date as YYYY-MM-DD in local timezone */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Compute confidence level based on number of valid sample days.
 */
function computeConfidence(sampleDays: number): "low" | "medium" | "high" {
  if (sampleDays < 7) return "low";
  if (sampleDays < 21) return "medium";
  return "high";
}

/**
 * Project capacity usage forward using linear extrapolation.
 *
 * @param deltas - Processed daily deltas (from computeDailyDeltas)
 * @param usedSoFar - Current used percentage
 * @param remainingDays - Fractional days until window reset
 * @param windowEnds - ISO timestamp of window end
 * @param service - Service name
 * @param metricName - Metric name (week_all, week_sonnet, weekly)
 * @param marks - Optional supervised marks for upcoming days
 */
export function predict(
  deltas: DailyDelta[],
  usedSoFar: number,
  remainingDays: number,
  windowEnds: string,
  service: string,
  metricName: string,
  marks?: SupervisedMark[],
): CapacityPrediction {
  const validDeltas = deltas.filter((d) => d.valid);
  const sampleDays = validDeltas.length;

  // Compute average daily rate
  let averageRate: number;
  let confidence: "low" | "medium" | "high";

  if (sampleDays === 0) {
    // Cold start: use conservative fixed rate
    averageRate = COLD_START_RATE;
    confidence = "low";
  } else {
    const sum = validDeltas.reduce((acc, d) => acc + d.delta, 0);
    averageRate = sum / sampleDays;
    confidence = computeConfidence(sampleDays);
  }

  // Build per-day rates for remaining days
  // Generate dates for each remaining day
  const now = new Date();
  const marksMap = new Map<string, number>();
  let hasMarks = false;

  if (marks && marks.length > 0) {
    for (const mark of marks) {
      const rate = REGIME_RATES[mark.regime];
      if (rate !== undefined) {
        marksMap.set(mark.date, rate);
        hasMarks = true;
      }
    }
  }

  // Project forward day by day, starting from today.
  // remainingDays is fractional (e.g., 3.5 means today has 0.5 days left + 3 full days).
  // We iterate from today forward so supervised marks match the correct calendar date.
  let projectedAdditional = 0;
  let daysAccountedFor = 0;

  // First partial day: today's remainder
  const todayStr = localDateStr(now);
  const todayFraction = Math.min(remainingDays, remainingDays - Math.floor(remainingDays) || 1);
  if (todayFraction > 0 && remainingDays > 0) {
    const todayRate = marksMap.get(todayStr) ?? averageRate;
    projectedAdditional += todayRate * todayFraction;
    daysAccountedFor += todayFraction;
  }

  // Full days after today
  let dayOffset = 1;
  while (daysAccountedFor + 1 <= remainingDays) {
    const dayDate = new Date(now);
    dayDate.setDate(dayDate.getDate() + dayOffset);
    const dateStr = localDateStr(dayDate);

    const dayRate = marksMap.get(dateStr) ?? averageRate;
    projectedAdditional += dayRate;
    daysAccountedFor += 1;
    dayOffset++;
  }

  // Last partial day (if window ends mid-day on a future date)
  const lastFraction = remainingDays - daysAccountedFor;
  if (lastFraction > 0.001) {
    const dayDate = new Date(now);
    dayDate.setDate(dayDate.getDate() + dayOffset);
    const dateStr = localDateStr(dayDate);

    const dayRate = marksMap.get(dateStr) ?? averageRate;
    projectedAdditional += dayRate * lastFraction;
  }

  const projectedTotal = usedSoFar + projectedAdditional;
  const predictedSpare = 100 - projectedTotal;
  const overBudget = projectedTotal > 100;

  // Determine source
  let source: "unsupervised" | "supervised" | "blended";
  if (!hasMarks) {
    source = "unsupervised";
  } else if (sampleDays === 0) {
    source = "supervised";
  } else {
    source = "blended";
  }

  return {
    service,
    metricName,
    usedSoFar,
    remainingDays: Math.round(remainingDays * 10) / 10,
    averageRate: Math.round(averageRate * 10) / 10,
    projectedTotal: Math.round(projectedTotal * 10) / 10,
    predictedSpare: Math.round(predictedSpare * 10) / 10,
    overBudget,
    source,
    confidence,
    sampleDays,
    windowEnds,
  };
}
