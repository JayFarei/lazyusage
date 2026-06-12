/**
 * Reactive metrics state management hook.
 */

import type { FetchResult, MetricsDict, ServiceName, ServiceWarning } from "@lazyusage/core";
import { detectLimitAdjustment, detectWarning } from "@lazyusage/core";
import { createSignal } from "solid-js";

export function useMetrics() {
  const [claudeMetrics, setClaudeMetrics] = createSignal<MetricsDict | null>(null);
  const [codexMetrics, setCodexMetrics] = createSignal<MetricsDict | null>(null);
  const [claudeError, setClaudeError] = createSignal<string | null>(null);
  const [codexError, setCodexError] = createSignal<string | null>(null);
  const [dataSources, setDataSources] = createSignal<Record<string, string>>({});
  const [warnings, setWarnings] = createSignal<ServiceWarning[]>([]);

  /** Previous metrics per service, used to detect limit adjustments */
  const prevMetrics: Record<string, MetricsDict> = {};

  function updateMetrics(service: ServiceName, metrics: MetricsDict | null, error: string | null, source: string) {
    // Detect limit adjustments before updating state
    if (metrics && prevMetrics[service]) {
      const adjustments = detectLimitAdjustment(service, prevMetrics[service], metrics);
      if (adjustments.length > 0) {
        setWarnings((prev) => {
          const filtered = prev.filter((w) => !(w.service === service && w.message.includes("limit adjusted")));
          return [...filtered, ...adjustments];
        });
      }
    }
    if (metrics) prevMetrics[service] = metrics;

    if (service === "claude") {
      if (error) {
        setClaudeError(error);
        setClaudeMetrics(null);
      } else {
        setClaudeError(null);
        setClaudeMetrics(metrics);
      }
    } else {
      if (error) {
        setCodexError(error);
        setCodexMetrics(null);
      } else {
        setCodexError(null);
        setCodexMetrics(metrics);
      }
    }
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
    claudeMetrics,
    codexMetrics,
    claudeError,
    codexError,
    dataSources,
    warnings,
    updateMetrics,
    checkWarning,
  };
}
