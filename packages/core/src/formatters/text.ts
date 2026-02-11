/**
 * Text formatter (matches bash script output format).
 * Port of src/formatters/text.py
 */

import type { MetricsDict } from "../types.js";

/** Format Claude metrics as text with subscription suffix */
export function formatClaudeText(metrics: MetricsDict): string {
  const subscription = metrics.subscription_type as string | null;
  const session = metrics.session as { used_pct: number; remaining_pct: number; resets: string };
  const weekAll = metrics.week_all as { used_pct: number; remaining_pct: number; resets: string };
  const weekSonnet = metrics.week_sonnet as { used_pct: number; remaining_pct: number; resets: string };

  const base = [
    `Session: ${session.used_pct}% used (${session.remaining_pct}% remaining) (resets ${session.resets})`,
    `Weekly: ${weekAll.used_pct}% used (${weekAll.remaining_pct}% remaining) (resets ${weekAll.resets})`,
    `Sonnet: ${weekSonnet.used_pct}% used (${weekSonnet.remaining_pct}% remaining) (resets ${weekSonnet.resets})`,
  ].join(" | ");

  if (subscription) {
    return `${base} [Subscription: ${subscription}]`;
  }
  return base;
}

/** Format Codex metrics as text with subscription suffix */
export function formatCodexText(metrics: MetricsDict): string {
  const subscription = metrics.subscription_type as string | null;
  const fiveH = metrics["5h"] as { used_pct: number; remaining_pct: number; resets: string };
  const weekly = metrics.weekly as { used_pct: number; remaining_pct: number; resets: string };

  const base = [
    `5h: ${fiveH.used_pct}% used (${fiveH.remaining_pct}% remaining) (resets ${fiveH.resets})`,
    `Weekly: ${weekly.used_pct}% used (${weekly.remaining_pct}% remaining) (resets ${weekly.resets})`,
  ].join(" | ");

  if (subscription) {
    return `${base} [Subscription: ${subscription}]`;
  }
  return base;
}

/** Format combined Claude and Codex metrics */
export function formatAllText(claudeMetrics: MetricsDict, codexMetrics: MetricsDict): string {
  const claudeLine = formatClaudeText(claudeMetrics);
  const codexLine = formatCodexText(codexMetrics);
  return `Claude: ${claudeLine}\nCodex: ${codexLine}`;
}

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
