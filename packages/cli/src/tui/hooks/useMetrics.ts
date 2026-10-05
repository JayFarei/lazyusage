/**
 * Reactive metrics state management hook.
 */

import type { FetchResult, MetricsDict, ServiceName, ServiceWarning } from "lazyusage-core";
import { detectLimitAdjustment, detectWarning } from "lazyusage-core";
import { createSignal } from "solid-js";

export function useMetrics() {
  const [metricsByService, setMetricsByService] = createSignal<Partial<Record<ServiceName, MetricsDict | null>>>({});
  const [errorsByService, setErrorsByService] = createSignal<Partial<Record<ServiceName, string | null>>>({});
  const [dataSources, setDataSources] = createSignal<Record<string, string>>({});
  const [warnings, setWarnings] = createSignal<ServiceWarning[]>([]);

  /** Previous metrics per service, used to detect limit adjustments */
  const prevMetrics: Partial<Record<ServiceName, MetricsDict>> = {};

  const metricsFor = (service: ServiceName): MetricsDict | null => metricsByService()[service] ?? null;
  const errorFor = (service: ServiceName): string | null => errorsByService()[service] ?? null;

  function updateMetrics(service: ServiceName, metrics: MetricsDict | null, error: string | null, source: string) {
    // Detect limit adjustments before updating state
    const previous = prevMetrics[service];
    if (metrics && previous) {
      const adjustments = detectLimitAdjustment(service, previous, metrics);
      if (adjustments.length > 0) {
        setWarnings((prev) => {
          const filtered = prev.filter((w) => !(w.service === service && w.message.includes("limit adjusted")));
          return [...filtered, ...adjustments];
        });
      }
    }
    if (metrics) prevMetrics[service] = metrics;

    setErrorsByService((prev) => ({ ...prev, [service]: error }));
    setMetricsByService((prev) => ({ ...prev, [service]: error ? null : metrics }));
    setDataSources((prev) => ({ ...prev, [service]: source }));
  }

  /** Check a FetchResult for auth/degradation warnings */
  function checkWarning(service: ServiceName, result: FetchResult) {
    const warning = detectWarning(service, result);
    setWarnings((prev) => {
      const filtered = prev.filter((w) => w.service !== service);
      return warning ? [...filtered, warning] : filtered;
    });
  }

  return {
    metricsFor,
    errorFor,
    dataSources,
    warnings,
    updateMetrics,
    checkWarning,
  };
}
