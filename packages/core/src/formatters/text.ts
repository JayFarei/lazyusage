/**
 * Text formatter (matches bash script output format).
 * Port of src/formatters/text.py
 */

import type { MetricsDict } from "../types.js";
import { calculateTimeProgress } from "../utils/time.js";

type MetricEntry = { used_pct: number; remaining_pct: number; resets: string };

function fmtMetric(label: string, m: MetricEntry, windowHours: number): string {
  const timeElapsed = Math.round(calculateTimeProgress(m.resets, windowHours));
  const capacityRemaining = Math.round(timeElapsed - m.used_pct);
  return `${label}: ${Math.round(m.used_pct)}% allowance used, ${timeElapsed}% time elapsed, ${capacityRemaining}% capacity remaining (resets ${m.resets})`;
}

/** Format Claude metrics as text with subscription suffix */
export function formatClaudeText(metrics: MetricsDict): string {
  const subscription = metrics.subscription_type as string | null;
  const session = metrics.session as MetricEntry;
  const weekAll = metrics.week_all as MetricEntry;
  const weekSonnet = metrics.week_sonnet as MetricEntry;

  const base = [
    fmtMetric("Session", session, 5),
    fmtMetric("Weekly", weekAll, 168),
    fmtMetric("Sonnet", weekSonnet, 168),
  ].join(" | ");

  if (subscription) {
    return `${base} [Subscription: ${subscription}]`;
  }
  return base;
}

/** Format Codex metrics as text with subscription suffix */
export function formatCodexText(metrics: MetricsDict): string {
  const subscription = metrics.subscription_type as string | null;
  const fiveH = metrics["5h"] as MetricEntry;
  const weekly = metrics.weekly as MetricEntry;

  const base = [
    fmtMetric("Session", fiveH, 5),
    fmtMetric("Weekly", weekly, 168),
  ].join(" | ");

  if (subscription) {
    return `${base} [Subscription: ${subscription}]`;
  }
  return base;
}

// ── Capacity-only formatters ──────────────────────────────────────────────────

function fmtCapacity(label: string, m: MetricEntry, windowHours: number): string {
  const timeElapsed = Math.round(calculateTimeProgress(m.resets, windowHours));
  const cap = timeElapsed - m.used_pct;
  const sign = cap > 0 ? "+" : "";
  return `${label}: ${sign}${cap}%`;
}

/** Format Claude capacity deltas only (time elapsed % - allowance used %) */
export function formatClaudeCapacityText(metrics: MetricsDict): string {
  const subscription = metrics.subscription_type as string | null;
  const session = metrics.session as MetricEntry;
  const weekAll = metrics.week_all as MetricEntry;
  const weekSonnet = metrics.week_sonnet as MetricEntry;

  const base = [
    fmtCapacity("Session", session, 5),
    fmtCapacity("Weekly", weekAll, 168),
    fmtCapacity("Sonnet", weekSonnet, 168),
  ].join(" | ");

  return subscription ? `${base} [Subscription: ${subscription}]` : base;
}

/** Format Codex capacity deltas only */
export function formatCodexCapacityText(metrics: MetricsDict): string {
  const subscription = metrics.subscription_type as string | null;
  const fiveH = metrics["5h"] as MetricEntry;
  const weekly = metrics.weekly as MetricEntry;

  const base = [
    fmtCapacity("Session", fiveH, 5),
    fmtCapacity("Weekly", weekly, 168),
  ].join(" | ");

  return subscription ? `${base} [Subscription: ${subscription}]` : base;
}

/** Format capacity with graceful handling of missing services */
export function formatCapacityWithAvailability(
  claudeMetrics: MetricsDict | null,
  codexMetrics: MetricsDict | null,
  availableServices: string[],
): string {
  const lines: string[] = [];

  if (claudeMetrics && availableServices.includes("claude")) {
    lines.push(`Claude: ${formatClaudeCapacityText(claudeMetrics)}`);
  } else {
    lines.push("Claude: [not available]");
  }

  if (codexMetrics && availableServices.includes("codex")) {
    lines.push(`Codex: ${formatCodexCapacityText(codexMetrics)}`);
  } else {
    lines.push("Codex: [not available]");
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────

/** Format metrics with graceful handling of missing services */
export function formatWithAvailability(
  claudeMetrics: MetricsDict | null,
  codexMetrics: MetricsDict | null,
  availableServices: string[],
): string {
  const lines: string[] = [];

  if (claudeMetrics && availableServices.includes("claude")) {
    lines.push(`Claude: ${formatClaudeText(claudeMetrics)}`);
  } else {
    lines.push("Claude: [not available]");
  }

  if (codexMetrics && availableServices.includes("codex")) {
    lines.push(`Codex: ${formatCodexText(codexMetrics)}`);
  } else {
    lines.push("Codex: [not available]");
  }

  return lines.join("\n");
}
