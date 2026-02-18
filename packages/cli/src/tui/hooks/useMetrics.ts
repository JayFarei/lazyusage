/**
 * Reactive metrics state management hook.
 */
import { createSignal } from "solid-js";
import type { MetricsDict, ServiceName } from "@usage-tui/core";

export function useMetrics() {
  const [claudeMetrics, setClaudeMetrics] = createSignal<MetricsDict | null>(null);
  const [codexMetrics, setCodexMetrics] = createSignal<MetricsDict | null>(null);
  const [claudeError, setClaudeError] = createSignal<string | null>(null);
  const [codexError, setCodexError] = createSignal<string | null>(null);
  const [dataSources, setDataSources] = createSignal<Record<string, string>>({});

  function updateMetrics(
    service: ServiceName,
    metrics: MetricsDict | null,
    error: string | null,
    source: string,
  ) {
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

  return {
    claudeMetrics,
    codexMetrics,
    claudeError,
    codexError,
    dataSources,
    updateMetrics,
  };
}
