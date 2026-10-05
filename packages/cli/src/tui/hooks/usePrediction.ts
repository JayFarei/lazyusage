/**
 * Reactive hook for capacity prediction.
 * Queries UsageStore for daily boundaries and runs prediction engine
 * on each 30s tick. Returns prediction state per metric or null on error.
 */

import {
  type CapacityPrediction,
  computeDailyDeltas,
  type MetricsDict,
  predict,
  SERVICES,
  type ServiceName,
  UsageStore,
  WEEKLY_WINDOW_HOURS,
} from "lazyusage-core";
import { createEffect, createSignal, on } from "solid-js";

type ServicePredictions = Record<string, CapacityPrediction>;

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
function predictForService(store: UsageStore, service: ServiceName, metrics: MetricsDict): ServicePredictions | null {
  const results: ServicePredictions = {};
  let hasAny = false;

  for (const metricName of SERVICES[service].predictableMetrics) {
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
    } catch {}
  }

  return hasAny ? results : null;
}

/**
 * Reactive prediction hook for the TUI.
 * @param tick - Shared 30s tick signal from App
 * @param metricsFor - Current metrics accessor per service
 * @param services - Services to predict for
 */
export function usePrediction(
  tick: () => number,
  metricsFor: (service: ServiceName) => MetricsDict | null,
  services: readonly ServiceName[],
): { predictionFor: (service: ServiceName) => ServicePredictions | null } {
  const [predictions, setPredictions] = createSignal<Partial<Record<ServiceName, ServicePredictions | null>>>({});

  let store: UsageStore | null = null;

  const computePredictions = () => {
    try {
      if (!store) {
        store = new UsageStore();
      }

      const next: Partial<Record<ServiceName, ServicePredictions | null>> = { ...predictions() };
      for (const service of services) {
        const metrics = metricsFor(service);
        if (metrics) next[service] = predictForService(store, service, metrics);
      }
      setPredictions(next);
    } catch {
      // Silent fallback
      setPredictions({});
    }
  };

  // Run on tick changes and whenever any service's metrics change
  createEffect(on(tick, computePredictions));
  createEffect(on(() => services.map(metricsFor), computePredictions));

  return { predictionFor: (service) => predictions()[service] ?? null };
}
