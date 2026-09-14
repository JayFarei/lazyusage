/**
 * Shared Codex rate-limit window classification.
 *
 * Codex reports up to two rate-limit windows per limit. Historically the
 * primary window was the 5-hour session and the secondary the weekly budget,
 * but since mid-2026 consumer plans expose a single weekly window as primary
 * and no secondary. Windows are therefore classified by their duration, never
 * by position, and the "5h" metric is only emitted when a short window exists.
 */

import { CODEX_PLAN_TYPE_MAP, WEEKLY_WINDOW_HOURS } from "../constants.js";
import type { MetricData, MetricsDict } from "../types.js";
import { calculateFallbackTime, formatResetFromIso } from "../utils/time.js";

export type CodexMetricKey = "5h" | "weekly";

export interface CodexRateWindow {
  usedPercent: number | null | undefined;
  /** Window length in seconds; when unknown the window is classified by position. */
  windowSeconds: number | null | undefined;
  /** Unix epoch seconds at which the window resets. */
  resetAtUnix: number | null | undefined;
}

/** Windows at or below this length count as the 5-hour session window. */
const SESSION_WINDOW_MAX_SECONDS = 6 * 3600;

/** Map a window to a metric key by duration, falling back to legacy positional order. */
export function classifyCodexWindow(windowSeconds: number | null | undefined, position: number): CodexMetricKey {
  if (windowSeconds !== null && windowSeconds !== undefined && Number.isFinite(windowSeconds)) {
    return windowSeconds <= SESSION_WINDOW_MAX_SECONDS ? "5h" : "weekly";
  }
  return position === 0 ? "5h" : "weekly";
}

function unixToIso(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return "";
  const dt = new Date(Number(ts) * 1000);
  return Number.isNaN(dt.getTime()) ? "" : dt.toISOString();
}

function toMetric(window: CodexRateWindow): MetricData {
  const used = Math.round(Number(window.usedPercent ?? 0)) || 0;
  return {
    used_pct: used,
    remaining_pct: 100 - used,
    resets: formatResetFromIso(unixToIso(window.resetAtUnix)),
  };
}

/**
 * Build the Codex MetricsDict from windows in provider order (primary first).
 * `weekly` is always present (zeros when unreported); `5h` only when a short
 * window was reported. The first window of each kind wins.
 */
export function buildCodexMetrics(
  planType: string | null | undefined,
  windows: Array<CodexRateWindow | null | undefined>,
): MetricsDict {
  const plan = planType ?? "unknown";
  const metrics: MetricsDict = { subscription_type: CODEX_PLAN_TYPE_MAP[plan] ?? plan };

  windows.forEach((window, position) => {
    if (!window) return;
    const key = classifyCodexWindow(window.windowSeconds, position);
    if (metrics[key] === undefined) metrics[key] = toMetric(window);
  });

  if (metrics.weekly === undefined) {
    metrics.weekly = {
      used_pct: 0,
      remaining_pct: 100,
      resets: calculateFallbackTime(WEEKLY_WINDOW_HOURS, false),
    };
  }

  return metrics;
}
