/**
 * Bar rendering utilities.
 * Ported from Python src/utils/bars.py
 */

export const BAR_WIDTH_STEP = 35;
export const MIN_BAR_WIDTH = 35;
export const MAX_BAR_WIDTH = 315;
export const MIN_TERMINAL_WIDTH = 70;
export const MIN_TERMINAL_HEIGHT = 35;

export function calculateBarWidth(availableWidth: number, overhead: number): number {
  const raw = availableWidth - overhead;
  const snapped = Math.floor(raw / BAR_WIDTH_STEP) * BAR_WIDTH_STEP;
  return Math.max(MIN_BAR_WIDTH, Math.min(snapped, MAX_BAR_WIDTH));
}

export function createTimeMarkers(divisions: number, barWidth: number): string {
  if (divisions <= 1) {
    return " ".repeat(barWidth);
  }

  const segment = Math.floor(barWidth / divisions);
  let bar = "";
  for (let i = 0; i < barWidth; i++) {
    if (i > 0 && i % segment === 0 && Math.floor(i / segment) < divisions) {
      bar += "\u2503";
    } else {
      bar += " ";
    }
  }
  return bar;
}

export function createCapacityBar(usedPct: number, barWidth: number): string {
  const filled = Math.round((usedPct / 100) * barWidth);
  return "\u2593".repeat(filled) + "\u2591".repeat(barWidth - filled);
}

export function createPeriodBar(timePct: number, barWidth: number): string {
  const filled = Math.round((timePct / 100) * barWidth);
  return "\u2593".repeat(filled) + "\u2591".repeat(barWidth - filled);
}

/**
 * Create a 3-segment prediction bar.
 * - used: ▓ (dark) — actual usage so far
 * - predicted: ▒ (medium) — predicted additional usage by window end
 * - spare: ░ (light) — predicted spare at window end
 *
 * The spare segment = barWidth - filled - predicted (never rounded independently)
 * to prevent rounding misalignment.
 */
export function createPredictionBar(
  usedPct: number,
  predictedPct: number,
  barWidth: number,
): { used: string; predicted: string; spare: string } {
  const filled = Math.min(barWidth, Math.round((usedPct / 100) * barWidth));
  const predictedRaw = Math.round((predictedPct / 100) * barWidth);
  const predicted = Math.min(predictedRaw, barWidth - filled); // clamp to remaining space
  const spare = barWidth - filled - predicted; // remainder, always >= 0
  return {
    used: "\u2593".repeat(filled),
    predicted: "\u2592".repeat(predicted),
    spare: "\u2591".repeat(spare),
  };
}
