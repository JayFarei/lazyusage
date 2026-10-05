/**
 * JSON formatter with service availability metadata.
 * Port of src/formatters/json.py
 */

import { SESSION_WINDOW_HOURS, WEEKLY_WINDOW_HOURS } from "../constants.js";
import { listedServices, SERVICE_NAMES } from "../services.js";
import type { MetricsDict, ServiceMetricsMap, ServiceName, ServiceResourceInfo } from "../types.js";
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

type MetricShape = { used_pct: number; remaining_pct: number; resets: string };

function metricEntries(metrics: MetricsDict | null | undefined): Array<[string, MetricShape]> {
  if (!metrics) return [];
  return Object.entries(metrics).flatMap(([name, data]) =>
    name === "subscription_type" || typeof data !== "object" || data === null ? [] : [[name, data as MetricShape]],
  );
}

function buildServicesOutput(
  metricsByService: ServiceMetricsMap,
  availableServices: string[],
  toMetric: (name: string, metric: MetricShape) => Record<string, unknown>,
  sources?: Record<string, string>,
  serviceInfo?: ServiceInfoMap,
  predictions?: Record<string, Record<string, unknown>>,
): string {
  const collected = Object.keys(metricsByService).filter((s) => metricsByService[s as ServiceName]);
  const services = listedServices(availableServices, collected).map((service) => {
    const metrics = metricsByService[service] ?? null;
    const envelope = buildServiceEnvelope(service, availableServices, metrics, sources, serviceInfo);
    envelope.metrics = metricEntries(metrics).map(([name, metric]) => toMetric(name, metric));
    if (predictions?.[service]) envelope.prediction = predictions[service];
    return envelope;
  });

  return JSON.stringify(
    { timestamp: new Date().toISOString(), available_services: availableServices, services },
    null,
    2,
  );
}

/** Format combined metrics with only capacity_remaining per metric */
export function formatCombinedCapacityJson(
  metricsByService: ServiceMetricsMap,
  availableServices: string[],
  sources?: Record<string, string>,
  serviceInfo?: ServiceInfoMap,
  predictions?: Record<string, Record<string, unknown>>,
): string {
  return buildServicesOutput(
    metricsByService,
    availableServices,
    capacityOnlyMetric,
    sources,
    serviceInfo,
    predictions,
  );
}

/** Format single service metrics as JSON string */
export function formatJson(service: string, metrics: MetricsDict): string {
  return JSON.stringify(
    {
      service,
      timestamp: new Date().toISOString(),
      subscription_type: (metrics.subscription_type as string) ?? null,
      metrics: metricEntries(metrics).map(([name, metric]) => enrichMetric(name, metric)),
    },
    null,
    2,
  );
}

/** Format metrics for every collected service, keyed by service name */
export function formatAllJson(metricsByService: ServiceMetricsMap): string {
  const services: Record<string, unknown> = {};
  for (const service of SERVICE_NAMES) {
    const metrics = metricsByService[service];
    if (!metrics) continue;
    services[service] = {
      subscription_type: (metrics.subscription_type as string) ?? null,
      metrics: metricEntries(metrics).map(([name, metric]) => enrichMetric(name, metric)),
    };
  }
  return JSON.stringify({ timestamp: new Date().toISOString(), services }, null, 2);
}

/** Format combined metrics with service availability metadata */
export function formatCombinedJson(
  metricsByService: ServiceMetricsMap,
  availableServices: string[],
  sources?: Record<string, string>,
  serviceInfo?: ServiceInfoMap,
  predictions?: Record<string, Record<string, unknown>>,
): string {
  return buildServicesOutput(metricsByService, availableServices, enrichMetric, sources, serviceInfo, predictions);
}
