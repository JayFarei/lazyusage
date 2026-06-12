/**
 * JSON formatter with service availability metadata.
 * Port of src/formatters/json.py
 */

import { SESSION_WINDOW_HOURS, WEEKLY_WINDOW_HOURS } from "../constants.js";
import type { MetricsDict, ServiceName, ServiceResourceInfo } from "../types.js";
import { calculateTimeProgress, formatTimeRemaining, parseTimeToDatetime } from "../utils/time.js";

const WINDOW_HOURS: Record<string, number> = {
  session: SESSION_WINDOW_HOURS,
  week_all: WEEKLY_WINDOW_HOURS,
  week_sonnet: WEEKLY_WINDOW_HOURS,
  "5h": SESSION_WINDOW_HOURS,
  weekly: WEEKLY_WINDOW_HOURS,
};

function enrichMetric(
  name: string,
  metric: { used_pct: number; remaining_pct: number; resets: string },
): Record<string, unknown> {
  const windowHours = WINDOW_HOURS[name] ?? 168;
  const timeElapsedPct = Math.round(calculateTimeProgress(metric.resets, windowHours));
  const capacityRemaining = timeElapsedPct - metric.used_pct;
  const resetsAt = parseTimeToDatetime(metric.resets);
  return {
    name,
    used_pct: metric.used_pct,
    remaining_pct: metric.remaining_pct,
    time_elapsed_pct: timeElapsedPct,
    capacity_remaining: capacityRemaining,
    resets: metric.resets,
    time_remaining: formatTimeRemaining(new Date(), resetsAt, windowHours),
  };
}

function capacityOnlyMetric(name: string, metric: { used_pct: number; resets: string }): Record<string, unknown> {
  const windowHours = WINDOW_HOURS[name] ?? 168;
  const timeElapsedPct = Math.round(calculateTimeProgress(metric.resets, windowHours));
  return { name, capacity_remaining: timeElapsedPct - metric.used_pct };
}

type ServiceInfoMap = Partial<Record<ServiceName, ServiceResourceInfo>>;

function buildServiceEnvelope(
  serviceName: ServiceName,
  availableServices: string[],
  metrics: MetricsDict | null,
  sources?: Record<string, string>,
  serviceInfo?: ServiceInfoMap,
): Record<string, unknown> {
  const info = serviceInfo?.[serviceName];
  return {
    name: serviceName,
    available: availableServices.includes(serviceName),
    source: info?.source ?? sources?.[serviceName] ?? null,
    stale: info?.stale ?? false,
    error: info?.error ?? null,
    subscription_type: metrics ? ((metrics.subscription_type as string) ?? null) : null,
    metrics: [] as Array<Record<string, unknown>>,
  };
}

/** Format combined metrics with only capacity_remaining per metric */
export function formatCombinedCapacityJson(
  claudeMetrics: MetricsDict | null,
  codexMetrics: MetricsDict | null,
  availableServices: string[],
  sources?: Record<string, string>,
  serviceInfo?: ServiceInfoMap,
  predictions?: Record<string, Record<string, unknown>>,
): string {
  const output: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    available_services: availableServices,
    services: [] as Array<Record<string, unknown>>,
  };

  const servicesList = output.services as Array<Record<string, unknown>>;

  const claudeService = buildServiceEnvelope("claude", availableServices, claudeMetrics, sources, serviceInfo);
  if (claudeMetrics) {
    for (const [name, data] of Object.entries(claudeMetrics)) {
      if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
      const metric = data as { used_pct: number; resets: string };
      (claudeService.metrics as Array<Record<string, unknown>>).push(capacityOnlyMetric(name, metric));
    }
  }
  if (predictions?.claude) {
    (claudeService as Record<string, unknown>).prediction = predictions.claude;
  }
  servicesList.push(claudeService);

  const codexService = buildServiceEnvelope("codex", availableServices, codexMetrics, sources, serviceInfo);
  if (codexMetrics) {
    for (const [name, data] of Object.entries(codexMetrics)) {
      if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
      const metric = data as { used_pct: number; resets: string };
      (codexService.metrics as Array<Record<string, unknown>>).push(capacityOnlyMetric(name, metric));
    }
  }
  if (predictions?.codex) {
    (codexService as Record<string, unknown>).prediction = predictions.codex;
  }
  servicesList.push(codexService);

  return JSON.stringify(output, null, 2);
}

/** Format single service metrics as JSON string */
export function formatJson(service: string, metrics: MetricsDict): string {
  const output: Record<string, unknown> = {
    service,
    timestamp: new Date().toISOString(),
    subscription_type: (metrics.subscription_type as string) ?? null,
    metrics: [] as Array<Record<string, unknown>>,
  };

  for (const [name, data] of Object.entries(metrics)) {
    if (name === "subscription_type" || typeof data !== "object" || data === null) {
      continue;
    }
    const metric = data as { used_pct: number; remaining_pct: number; resets: string };
    (output.metrics as Array<Record<string, unknown>>).push(enrichMetric(name, metric));
  }

  return JSON.stringify(output, null, 2);
}

/** Format combined Claude and Codex metrics as JSON string */
export function formatAllJson(claudeMetrics: MetricsDict, codexMetrics: MetricsDict): string {
  const output: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    services: {
      claude: {
        subscription_type: (claudeMetrics.subscription_type as string) ?? null,
        metrics: [] as Array<Record<string, unknown>>,
      },
      codex: {
        subscription_type: (codexMetrics.subscription_type as string) ?? null,
        metrics: [] as Array<Record<string, unknown>>,
      },
    },
  };

  const services = output.services as Record<
    string,
    { subscription_type: string | null; metrics: Array<Record<string, unknown>> }
  >;

  for (const [name, data] of Object.entries(claudeMetrics)) {
    if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
    const metric = data as { used_pct: number; remaining_pct: number; resets: string };
    services.claude.metrics.push(enrichMetric(name, metric));
  }

  for (const [name, data] of Object.entries(codexMetrics)) {
    if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
    const metric = data as { used_pct: number; remaining_pct: number; resets: string };
    services.codex.metrics.push(enrichMetric(name, metric));
  }

  return JSON.stringify(output, null, 2);
}

/** Format combined metrics with service availability metadata */
export function formatCombinedJson(
  claudeMetrics: MetricsDict | null,
  codexMetrics: MetricsDict | null,
  availableServices: string[],
  sources?: Record<string, string>,
  serviceInfo?: ServiceInfoMap,
  predictions?: Record<string, Record<string, unknown>>,
): string {
  const output: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    available_services: availableServices,
    services: [] as Array<Record<string, unknown>>,
  };

  const servicesList = output.services as Array<Record<string, unknown>>;

  // Claude service
  const claudeService = buildServiceEnvelope("claude", availableServices, claudeMetrics, sources, serviceInfo);
  if (claudeMetrics) {
    for (const [name, data] of Object.entries(claudeMetrics)) {
      if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
      const metric = data as { used_pct: number; remaining_pct: number; resets: string };
      (claudeService.metrics as Array<Record<string, unknown>>).push(enrichMetric(name, metric));
    }
  }
  if (predictions?.claude) {
    (claudeService as Record<string, unknown>).prediction = predictions.claude;
  }
  servicesList.push(claudeService);

  // Codex service
  const codexService = buildServiceEnvelope("codex", availableServices, codexMetrics, sources, serviceInfo);
  if (codexMetrics) {
    for (const [name, data] of Object.entries(codexMetrics)) {
      if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
      const metric = data as { used_pct: number; remaining_pct: number; resets: string };
      (codexService.metrics as Array<Record<string, unknown>>).push(enrichMetric(name, metric));
    }
  }
  if (predictions?.codex) {
    (codexService as Record<string, unknown>).prediction = predictions.codex;
  }
  servicesList.push(codexService);

  return JSON.stringify(output, null, 2);
}
