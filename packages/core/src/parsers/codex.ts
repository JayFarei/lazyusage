/**
 * Parser for Codex CLI /status output.
 * Port of src/parsers/codex.py
 */

import type { MetricsDict } from "../types.js";
import { calculateFallbackTime, format12hTime, formatResetDate } from "../utils/time.js";

/** Parse month string to month number (0-indexed for JS Date) */
function parseMonth(monthStr: string): number | null {
  const months: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  };
  return months[monthStr.toLowerCase()] ?? null;
}

/** Parse 5h limit metric from Codex /status output */
export function parse5hLimit(output: string): { used_pct: number | null; remaining_pct: number | null; resets: string | null } {
  const leftMatch = output.match(/5h limit:.*?(\d+)% left/);
  const leftPct = leftMatch ? parseInt(leftMatch[1], 10) : null;

  const resetMatch = output.match(/5h limit:.*?resets\s+([0-9:]+)/);
  const resetRaw = resetMatch ? resetMatch[1].trim() : null;

  let resets: string | null = null;
  if (resetRaw && resetRaw.includes(":")) {
    const [hourStr, minuteStr] = resetRaw.split(":");
    resets = format12hTime(parseInt(hourStr, 10), parseInt(minuteStr, 10));
  }

  return {
    used_pct: leftPct !== null ? 100 - leftPct : null,
    remaining_pct: leftPct,
    resets,
  };
}

/** Parse weekly limit metric from Codex /status output (multi-line) */
export function parseWeeklyLimit(output: string): { used_pct: number | null; remaining_pct: number | null; resets: string | null } {
  const leftMatch = output.match(/weekly limit:.*?(\d+)% left/i);
  const leftPct = leftMatch ? parseInt(leftMatch[1], 10) : null;

  // Reset time is on the next line after "Weekly limit:"
  const resetMatch = output.match(/weekly limit:.*?\n.*?resets\s+(.+)/is);

  let resets: string | null = null;
  if (resetMatch) {
    const resetRaw = resetMatch[1].trim();

    // Parse "HH:MM on D Mon" format
    const timeMatch = resetRaw.match(/(\d+):(\d+)\s+on\s+(\d+)\s+(\w+)/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);
      const day = parseInt(timeMatch[3], 10);
      const monthStr = timeMatch[4];

      const monthNum = parseMonth(monthStr);
      if (monthNum !== null) {
        const resetDt = new Date(new Date().getFullYear(), monthNum, day, hour, minute);
        resets = formatResetDate(resetDt);
      }
    }
  }

  return {
    used_pct: leftPct !== null ? 100 - leftPct : null,
    remaining_pct: leftPct,
    resets,
  };
}

/** Parse subscription type from Codex /status output */
export function parseSubscription(output: string): string | null {
  const match = output.match(/Account:.*?\(([A-Za-z]+)\)/);
  if (match) {
    const sub = match[1];
    return sub.charAt(0).toUpperCase() + sub.slice(1).toLowerCase();
  }
  return null;
}

/** Apply fallback values to missing metrics */
export function applyFallbacks(metrics: Record<string, { used_pct: number | null; remaining_pct: number | null; resets: string | null }>): void {
  // 5h fallbacks
  if (metrics["5h"].used_pct === null) {
    metrics["5h"].used_pct = 0;
    metrics["5h"].remaining_pct = 100;
  }
  if (metrics["5h"].resets === null) {
    metrics["5h"].resets = calculateFallbackTime(5, true);
  }

  // Weekly fallbacks
  if (metrics.weekly.used_pct === null) {
    metrics.weekly.used_pct = 0;
    metrics.weekly.remaining_pct = 100;
  }
  if (metrics.weekly.resets === null) {
    metrics.weekly.resets = calculateFallbackTime(168, false);
  }
}

/** Parse complete Codex status output */
export function parseCodexOutput(output: string): MetricsDict {
  const metrics = {
    "5h": parse5hLimit(output),
    weekly: parseWeeklyLimit(output),
  };

  applyFallbacks(metrics);

  const subscription = parseSubscription(output);

  return {
    subscription_type: subscription,
    ...metrics,
  } as unknown as MetricsDict;
}
