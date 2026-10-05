/**
 * Text formatter (matches bash script output format).
 * Port of src/formatters/text.py
 */

import { listedServices, SERVICES, type ServiceName } from "../services.js";
import type { MetricsDict, ServiceMetricsMap } from "../types.js";
import { calculateTimeProgress } from "../utils/time.js";

type MetricEntry = { used_pct: number; remaining_pct: number; resets: string };

function isMetricEntry(v: unknown): v is MetricEntry {
  return v !== null && typeof v === "object" && "used_pct" in v;
}

/** A service's reported metrics in text order; optional windows (e.g. Codex 5h) are skipped when absent. */
function serviceEntries(
  service: ServiceName,
  metrics: MetricsDict,
): Array<[label: string, m: MetricEntry, windowHours: number]> {
  const entries: Array<[string, MetricEntry, number]> = [];
  for (const spec of SERVICES[service].textMetrics) {
    const value = metrics[spec.key];
    if (isMetricEntry(value)) entries.push([spec.textLabel, value, spec.windowHours]);
  }
  return entries;
}

function withSubscription(base: string, metrics: MetricsDict): string {
  const subscription = metrics.subscription_type as string | null;
  return subscription ? `${base} [Subscription: ${subscription}]` : base;
}

function fmtMetric(label: string, m: MetricEntry, windowHours: number): string {
  const timeElapsed = Math.round(calculateTimeProgress(m.resets, windowHours));
  const capacityRemaining = Math.round(timeElapsed - m.used_pct);
  return `${label}: ${Math.round(m.used_pct)}% allowance used, ${timeElapsed}% time elapsed, ${capacityRemaining}% capacity remaining (resets ${m.resets})`;
}

function fmtCapacity(label: string, m: MetricEntry, windowHours: number): string {
  const timeElapsed = Math.round(calculateTimeProgress(m.resets, windowHours));
  const cap = Math.round(timeElapsed - m.used_pct);
  const sign = cap > 0 ? "+" : "";
  return `${label}: ${sign}${cap}%`;
}

/** Format one service's metrics as text with subscription suffix */
export function formatServiceText(service: ServiceName, metrics: MetricsDict): string {
  const base = serviceEntries(service, metrics)
    .map(([label, m, hours]) => fmtMetric(label, m, hours))
    .join(" | ");
  return withSubscription(base, metrics);
}

/** Format one service's capacity deltas only (time elapsed % - allowance used %) */
export function formatServiceCapacityText(service: ServiceName, metrics: MetricsDict): string {
  const base = serviceEntries(service, metrics)
    .map(([label, m, hours]) => fmtCapacity(label, m, hours))
    .join(" | ");
  return withSubscription(base, metrics);
}

export const formatClaudeText = (metrics: MetricsDict) => formatServiceText("claude", metrics);
export const formatCodexText = (metrics: MetricsDict) => formatServiceText("codex", metrics);
export const formatGrokText = (metrics: MetricsDict) => formatServiceText("grok", metrics);
export const formatClaudeCapacityText = (metrics: MetricsDict) => formatServiceCapacityText("claude", metrics);
export const formatCodexCapacityText = (metrics: MetricsDict) => formatServiceCapacityText("codex", metrics);
export const formatGrokCapacityText = (metrics: MetricsDict) => formatServiceCapacityText("grok", metrics);

function formatLines(
  metricsByService: ServiceMetricsMap,
  availableServices: string[],
  format: (service: ServiceName, metrics: MetricsDict) => string,
): string {
  const collected = Object.keys(metricsByService).filter((s) => metricsByService[s as ServiceName]);
  return listedServices(availableServices, collected)
    .map((service) => {
      const metrics = metricsByService[service];
      const label = SERVICES[service].label;
      return metrics && availableServices.includes(service)
        ? `${label}: ${format(service, metrics)}`
        : `${label}: [not available]`;
    })
    .join("\n");
}

/** Format capacity for every service, marking missing ones as not available */
export function formatCapacityWithAvailability(
  metricsByService: ServiceMetricsMap,
  availableServices: string[],
): string {
  return formatLines(metricsByService, availableServices, formatServiceCapacityText);
}

/** Format metrics for every service, marking missing ones as not available */
export function formatWithAvailability(metricsByService: ServiceMetricsMap, availableServices: string[]): string {
  return formatLines(metricsByService, availableServices, formatServiceText);
}

// ── Prediction formatters ────────────────────────────────────────────────────

/** Format a prediction result as human-readable text */
export function formatPredictionText(prediction: {
  predictedSpare: number;
  confidence: string;
  sampleDays: number;
  overBudget: boolean;
}): string {
  const { predictedSpare, confidence, sampleDays, overBudget } = prediction;
  const spare = Math.round(predictedSpare);
  if (overBudget) {
    return `Predicted spare at window end: OVER BUDGET ${spare}% (${confidence} confidence, ${sampleDays} days history)`;
  }
  const sign = spare > 0 ? "+" : "";
  return `Predicted spare at window end: ${sign}${spare}% (${confidence} confidence, ${sampleDays} days history)`;
}

/** Format prediction as a compact capacity-style suffix */
export function formatPredictionCapacitySuffix(prediction: { predictedSpare: number; overBudget: boolean }): string {
  if (prediction.overBudget) {
    return `Predicted: OVER BUDGET ${Math.round(prediction.predictedSpare)}%`;
  }
  const spare = Math.round(prediction.predictedSpare);
  const sign = spare > 0 ? "+" : "";
  return `Predicted: ${sign}${spare}% spare`;
}
