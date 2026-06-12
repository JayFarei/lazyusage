/**
 * Auth and data-source warning detection.
 * Detects degraded states from FetchResult and returns actionable user messages.
 */

import { DataSource, type FetchResult, type MetricData, type MetricsDict } from "../types.js";
import { parseTimeToDatetime } from "./time.js";

export interface ServiceWarning {
  service: string;
  message: string;
  action: string;
}

const AUTH_ERROR_PATTERNS = [/401/i, /403/i, /unauthorized/i, /token.?expired/i, /credentials/i, /authentication/i];

/**
 * Detect actionable warnings from a fetch result.
 * Returns null if no warning is needed.
 */
export function detectWarning(service: "claude" | "codex", result: FetchResult): ServiceWarning | null {
  // No error and good source = no warning
  if (!result.error && result.source === DataSource.API) return null;

  const error = result.error ?? "";

  // 429 rate limits are normal, not a warning - cache fallback handles it gracefully
  if (/429|rate.?limit/i.test(error)) return null;

  const isAuthError = AUTH_ERROR_PATTERNS.some((p) => p.test(error));

  if (isAuthError) {
    const loginCmd = service === "claude" ? "claude" : "codex login";
    return {
      service,
      message: `${service} auth expired`,
      action: `run \`${loginCmd}\` to re-authenticate`,
    };
  }

  // Degraded to cache/fallback with a non-auth error
  if (result.source === DataSource.CACHE || result.source === DataSource.FALLBACK) {
    if (error.includes("All providers failed")) {
      const loginCmd = service === "claude" ? "claude" : "codex login";
      return {
        service,
        message: `${service} data unavailable`,
        action: `check credentials with \`${loginCmd}\``,
      };
    }
  }

  return null;
}

/**
 * Format a warning for display in the status bar (compact, single-line).
 */
export function formatWarningCompact(warning: ServiceWarning): string {
  return `${warning.message}, ${warning.action}`;
}

/**
 * Format a warning for stderr output (CLI modes).
 */
export function formatWarningStderr(warning: ServiceWarning): string {
  return `Warning: ${warning.message}. To fix: ${warning.action}`;
}

/** Threshold: reset time must shift forward by at least 2 hours */
const RESET_SHIFT_THRESHOLD_MS = 2 * 3600_000;
/** Threshold: used_pct must drop by at least 10 points */
const USAGE_DROP_THRESHOLD = 10;

const METRIC_LABELS: Record<string, string> = {
  session: "session",
  week_all: "weekly",
  week_sonnet: "weekly sonnet",
  "5h": "session",
  weekly: "weekly",
};

function isMetricData(v: unknown): v is MetricData {
  return v !== null && typeof v === "object" && "used_pct" in (v as Record<string, unknown>);
}

/**
 * Parse a reset time string to a Date using a shared reference point.
 * Unlike parseTimeToDatetime (which assumes future), this uses a fixed
 * reference so that comparing two times gives the correct relative shift.
 */
function parseResetForComparison(timeStr: string, referenceDate: Date): Date {
  // "Feb 20 at 3:00pm" format - includes a date, parse directly
  if (timeStr.includes(" at ")) {
    return parseTimeToDatetime(timeStr);
  }

  // "3:00pm" format - parse relative to the reference date (no tomorrow wrapping)
  const match = timeStr.match(/^(\d+)(?::(\d+))?\s*(am|pm)$/i);
  if (!match) return referenceDate;

  const [, hourStr, minuteStr, meridiem] = match;
  let hour = parseInt(hourStr, 10);
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0;

  if (meridiem.toLowerCase() === "pm" && hour !== 12) hour += 12;
  if (meridiem.toLowerCase() === "am" && hour === 12) hour = 0;

  return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), hour, minute);
}

/**
 * Detect when a provider (e.g. Anthropic) adjusts limits mid-cycle.
 * Signals: resets_at shifts forward significantly AND used_pct drops.
 * Returns warnings for each adjusted metric, or an empty array.
 */
export function detectLimitAdjustment(
  service: "claude" | "codex",
  prev: MetricsDict,
  current: MetricsDict,
): ServiceWarning[] {
  const warnings: ServiceWarning[] = [];
  const now = new Date();

  for (const key of Object.keys(current)) {
    const prevEntry = prev[key];
    const currEntry = current[key];
    if (!isMetricData(prevEntry) || !isMetricData(currEntry)) continue;
    if (!prevEntry.resets || !currEntry.resets) continue;

    const prevReset = parseResetForComparison(prevEntry.resets, now);
    const currReset = parseResetForComparison(currEntry.resets, now);
    const shiftMs = currReset.getTime() - prevReset.getTime();
    const usageDrop = prevEntry.used_pct - currEntry.used_pct;

    if (shiftMs > RESET_SHIFT_THRESHOLD_MS && usageDrop >= USAGE_DROP_THRESHOLD) {
      const label = METRIC_LABELS[key] ?? key;
      warnings.push({
        service,
        message: `${service} ${label} limit adjusted by provider`,
        action: `reset moved, usage recalculated (${prevEntry.used_pct}% -> ${currEntry.used_pct}%)`,
      });
    }
  }

  return warnings;
}
