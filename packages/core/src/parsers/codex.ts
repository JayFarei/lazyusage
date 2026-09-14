/**
 * Parser for Codex CLI /status output.
 *
 * The status box lists the account-wide limits first, then optional per-model
 * sections introduced by a bare "<Model> limit:" header line (for example
 * "GPT-5.3-Codex-Spark limit:"). Only the account-wide section is parsed.
 * Current plans report a weekly limit only; the 5h limit is emitted when present.
 */

import { SESSION_WINDOW_HOURS, WEEKLY_WINDOW_HOURS } from "../constants.js";
import type { MetricsDict } from "../types.js";
import { calculateFallbackTime, format12hTime, formatResetDate } from "../utils/time.js";

/** Parse month string to month number (0-indexed for JS Date) */
function parseMonth(monthStr: string): number | null {
  const months: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };
  return months[monthStr.toLowerCase()] ?? null;
}

/** Keep only the account-wide limits, cutting at the first per-model "<Model> limit:" header line. */
export function accountLimitSection(output: string): string {
  const lines = output.split("\n");
  const headerIdx = lines.findIndex((line) => /\blimit:\s*[│|]?\s*$/.test(line));
  return headerIdx === -1 ? output : lines.slice(0, headerIdx).join("\n");
}

/** Parse 5h limit metric from Codex /status output */
export function parse5hLimit(output: string): {
  used_pct: number | null;
  remaining_pct: number | null;
  resets: string | null;
} {
  const leftMatch = output.match(/5h limit:.*?(\d+)% left/);
  const leftPct = leftMatch ? parseInt(leftMatch[1], 10) : null;

  const resetMatch = output.match(/5h limit:.*?resets\s+([0-9:]+)/);
  const resetRaw = resetMatch ? resetMatch[1].trim() : null;

  let resets: string | null = null;
  if (resetRaw?.includes(":")) {
    const [hourStr, minuteStr] = resetRaw.split(":");
    resets = format12hTime(parseInt(hourStr, 10), parseInt(minuteStr, 10));
  }

  return {
    used_pct: leftPct !== null ? 100 - leftPct : null,
    remaining_pct: leftPct,
    resets,
  };
}

/** Parse weekly limit metric from Codex /status output */
export function parseWeeklyLimit(output: string): {
  used_pct: number | null;
  remaining_pct: number | null;
  resets: string | null;
} {
  const leftMatch = output.match(/weekly limit:.*?(\d+)% left/i);
  const leftPct = leftMatch ? parseInt(leftMatch[1], 10) : null;

  // Reset time is on the same line ("... 72% left (resets 10:32 on 19 Sep)") or,
  // in older builds, on the line after "Weekly limit:".
  const sameLine = output.match(/weekly limit:[^\n]*?resets\s+([^)\n]+)/i);
  const nextLine = sameLine ? null : output.match(/weekly limit:[^\n]*\n[^\n]*?resets\s+([^)\n]+)/i);
  const resetRaw = (sameLine ?? nextLine)?.[1].trim() ?? null;

  let resets: string | null = null;
  if (resetRaw) {
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

/** Parse subscription type from Codex /status output, e.g. "(pro)" -> "Pro", "(Pro Lite)" -> "Pro Lite" */
export function parseSubscription(output: string): string | null {
  const match = output.match(/Account:.*?\(([A-Za-z][A-Za-z ]*)\)/);
  if (!match) return null;
  return match[1]
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Parse complete Codex status output.
 * `weekly` is always present (zeros with a fallback reset when unparsed);
 * `5h` only when the account-wide section reports one.
 */
export function parseCodexOutput(output: string): MetricsDict {
  const section = accountLimitSection(output);
  const fiveH = parse5hLimit(section);
  const weekly = parseWeeklyLimit(section);

  const metrics: MetricsDict = { subscription_type: parseSubscription(output) };

  if (fiveH.used_pct !== null && fiveH.remaining_pct !== null) {
    metrics["5h"] = {
      used_pct: fiveH.used_pct,
      remaining_pct: fiveH.remaining_pct,
      resets: fiveH.resets ?? calculateFallbackTime(SESSION_WINDOW_HOURS, true),
    };
  }

  metrics.weekly = {
    used_pct: weekly.used_pct ?? 0,
    remaining_pct: weekly.remaining_pct ?? 100,
    resets: weekly.resets ?? calculateFallbackTime(WEEKLY_WINDOW_HOURS, false),
  };

  return metrics;
}
