/**
 * JSON formatter with service availability metadata.
 * Port of src/formatters/json.py
 */

import type { MetricsDict } from "../types.js";

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
    (output.metrics as Array<Record<string, unknown>>).push({
      name,
      used_pct: metric.used_pct,
      remaining_pct: metric.remaining_pct,
      resets: metric.resets,
    });
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

  const services = output.services as Record<string, { subscription_type: string | null; metrics: Array<Record<string, unknown>> }>;

  for (const [name, data] of Object.entries(claudeMetrics)) {
    if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
    const metric = data as { used_pct: number; remaining_pct: number; resets: string };
    services.claude.metrics.push({
      name,
      used_pct: metric.used_pct,
      remaining_pct: metric.remaining_pct,
      resets: metric.resets,
    });
  }

  for (const [name, data] of Object.entries(codexMetrics)) {
    if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
    const metric = data as { used_pct: number; remaining_pct: number; resets: string };
    services.codex.metrics.push({
      name,
      used_pct: metric.used_pct,
      remaining_pct: metric.remaining_pct,
      resets: metric.resets,
    });
  }

  return JSON.stringify(output, null, 2);
}

/** Format combined metrics with service availability metadata */
export function formatCombinedJson(
  claudeMetrics: MetricsDict | null,
  codexMetrics: MetricsDict | null,
  availableServices: string[],
): string {
  const output: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    available_services: availableServices,
    services: [] as Array<Record<string, unknown>>,
  };

  const servicesList = output.services as Array<Record<string, unknown>>;

  // Claude service
  const claudeService: Record<string, unknown> = {
    name: "claude",
    available: availableServices.includes("claude"),
    subscription_type: claudeMetrics ? ((claudeMetrics.subscription_type as string) ?? null) : null,
    metrics: [] as Array<Record<string, unknown>>,
  };

  if (claudeMetrics) {
    for (const [name, data] of Object.entries(claudeMetrics)) {
      if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
      const metric = data as { used_pct: number; remaining_pct: number; resets: string };
      (claudeService.metrics as Array<Record<string, unknown>>).push({
        name,
        used_pct: metric.used_pct,
        remaining_pct: metric.remaining_pct,
        resets: metric.resets,
      });
    }
  }
  servicesList.push(claudeService);

  // Codex service
  const codexService: Record<string, unknown> = {
    name: "codex",
    available: availableServices.includes("codex"),
    subscription_type: codexMetrics ? ((codexMetrics.subscription_type as string) ?? null) : null,
    metrics: [] as Array<Record<string, unknown>>,
  };

  if (codexMetrics) {
    for (const [name, data] of Object.entries(codexMetrics)) {
      if (name === "subscription_type" || typeof data !== "object" || data === null) continue;
      const metric = data as { used_pct: number; remaining_pct: number; resets: string };
      (codexService.metrics as Array<Record<string, unknown>>).push({
        name,
        used_pct: metric.used_pct,
        remaining_pct: metric.remaining_pct,
        resets: metric.resets,
      });
    }
  }
  servicesList.push(codexService);

  return JSON.stringify(output, null, 2);
}
