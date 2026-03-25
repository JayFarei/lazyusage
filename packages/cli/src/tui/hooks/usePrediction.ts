/**
 * Reactive hook for capacity prediction.
 * Queries UsageStore for daily boundaries and runs prediction engine
 * on each 30s tick. Returns prediction state per metric or null on error.
 */
import { createSignal, createEffect, on } from "solid-js";
import {
  UsageStore,
  computeDailyDeltas,
  predict,
  type CapacityPrediction,
  type ServiceName,
  type MetricsDict,
  WEEKLY_WINDOW_HOURS,
} from "@lazyusage/core";

/** Weekly metric keys that are predictable */
const PREDICTABLE_METRICS: Record<string, string[]> = {
  claude: ["week_all", "week_sonnet"],
  codex: ["weekly"],
};

/**
 * Compute remaining fractional days until window end from a resets_at ISO string.
 */
function computeRemainingDays(resetsAtIso: string): number {
  const resetTime = new Date(resetsAtIso).getTime();
  const now = Date.now();
  const msRemaining = resetTime - now;
  return Math.max(0, msRemaining / (24 * 3600_000));
}

/**
 * Run prediction for a single service.
 */
function predictForService(
  store: UsageStore,
  service: ServiceName,
  metrics: MetricsDict,
): Record<string, CapacityPrediction> | null {
  const metricKeys = PREDICTABLE_METRICS[service];
  if (!metricKeys) return null;

  const results: Record<string, CapacityPrediction> = {};
  let hasAny = false;

  for (const metricName of metricKeys) {
    const metricData = metrics[metricName];
    if (!metricData || typeof metricData !== "object" || !("used_pct" in metricData)) continue;

    try {
      const boundaries = store.getDailyBoundaries(service, metricName, 30);
      const deltas = computeDailyDeltas(boundaries);

      // Get resets_at from the most recent boundary, or compute from resets string
      let windowEnds: string;
      const lastBoundary = boundaries[boundaries.length - 1];
      if (lastBoundary?.resetsAt) {
        windowEnds = lastBoundary.resetsAt;
      } else {
        // Fallback: estimate from current time + remaining window
        windowEnds = new Date(Date.now() + WEEKLY_WINDOW_HOURS * 3600_000).toISOString();
      }

      const remainingDays = computeRemainingDays(windowEnds);
      const marks = store.getCapacityMarks();

      const prediction = predict(
        deltas,
        (metricData as { used_pct: number }).used_pct,
        remainingDays,
        windowEnds,
        service,
        metricName,
        marks,
      );

      results[metricName] = prediction;
      hasAny = true;
    } catch {
      // Silent fallback on error
      continue;
    }
  }

  return hasAny ? results : null;
}

/**
 * Reactive prediction hook for the TUI.
 * @param tick - Shared 30s tick signal from App
 */
export function usePrediction(
  tick: () => number,
  claudeMetrics: () => MetricsDict | null,
  codexMetrics: () => MetricsDict | null,
): {
  claudePrediction: () => Record<string, CapacityPrediction> | null;
  codexPrediction: () => Record<string, CapacityPrediction> | null;
} {
  const [claudePrediction, setClaudePrediction] = createSignal<Record<string, CapacityPrediction> | null>(null);
  const [codexPrediction, setCodexPrediction] = createSignal<Record<string, CapacityPrediction> | null>(null);

  let store: UsageStore | null = null;

  const computePredictions = () => {
    try {
      if (!store) {
        store = new UsageStore();
      }

      const cm = claudeMetrics();
      if (cm) {
        setClaudePrediction(predictForService(store, "claude", cm));
      }

      const cx = codexMetrics();
      if (cx) {
        setCodexPrediction(predictForService(store, "codex", cx));
      }
    } catch {
      // Silent fallback
      setClaudePrediction(null);
      setCodexPrediction(null);
    }
  };

  // Run on tick changes
  createEffect(on(tick, computePredictions));

  // Also run when metrics change
  createEffect(on(claudeMetrics, computePredictions));
  createEffect(on(codexMetrics, computePredictions));

  return { claudePrediction, codexPrediction };
}
