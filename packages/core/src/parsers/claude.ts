/**
 * Parser for Claude CLI usage output.
 */

import type { MetricsDict } from "../types.js";
import { calculateFallbackTime } from "../utils/time.js";

/** Parse session metric from Claude /usage output */
export function parseSession(output: string): { used_pct: number | null; remaining_pct: number | null; resets: string | null } {
  const usedMatch = output.match(/Current session[\s\S]*?(\d+)% used/);
  const usedPct = usedMatch ? parseInt(usedMatch[1], 10) : null;

  const resetsMatch = output.match(/Current session[\s\S]*?Resets\s+([^(]+)/);
  const resets = resetsMatch ? resetsMatch[1].trim() : null;

  return {
    used_pct: usedPct,
    remaining_pct: usedPct !== null ? 100 - usedPct : null,
    resets,
  };
}

/** Parse weekly all-models metric from Claude /usage output */
export function parseWeekAll(output: string): { used_pct: number | null; remaining_pct: number | null; resets: string | null } {
  const usedMatch = output.match(/Current week \(all models\)[\s\S]*?(\d+)% used/);
  const usedPct = usedMatch ? parseInt(usedMatch[1], 10) : null;

  const resetsMatch = output.match(/Current week \(all models\)[\s\S]*?Resets\s+([^(]+)/);
  const resets = resetsMatch ? resetsMatch[1].trim() : null;

  return {
    used_pct: usedPct,
    remaining_pct: usedPct !== null ? 100 - usedPct : null,
    resets,
  };
}

/** Parse weekly Sonnet-only metric from Claude /usage output */
export function parseWeekSonnet(output: string): { used_pct: number | null; remaining_pct: number | null; resets: string | null } {
  const usedMatch = output.match(/Current week \(Sonnet only\)[\s\S]*?(\d+)% used/);
  const usedPct = usedMatch ? parseInt(usedMatch[1], 10) : null;

  const resetsMatch = output.match(/Current week \(Sonnet only\)[\s\S]*?Resets\s+([^(]+)/);
  const resets = resetsMatch ? resetsMatch[1].trim() : null;

  return {
    used_pct: usedPct,
    remaining_pct: usedPct !== null ? 100 - usedPct : null,
    resets,
  };
}

/** Parse subscription type from Claude landing page */
export function parseSubscription(output: string): string | null {
  // Priority 1: "· Claude Max" or "· Claude Pro"
  const dotMatch = output.match(/·\s+Claude\s+(Max|Pro|Plus)/);
  if (dotMatch) {
    return dotMatch[1];
  }

  // Priority 2: Look for subscription keywords near Claude/Sonnet
  for (const line of output.split("\n")) {
    if (line.includes("Claude") || line.includes("Sonnet")) {
      if (/\bMax\b/.test(line)) return "Max";
      if (/\bPro\b/.test(line)) return "Pro";
      if (/\bPlus\b/.test(line)) return "Plus";
    }
  }

  // Priority 3: Generic "Claude [Type]"
  const genericMatch = output.match(/Claude\s+([A-Z][a-z]+)/);
  if (genericMatch) {
    const subscription = genericMatch[1];
    if (subscription !== "Code") {
      return subscription;
    }
  }

  return null;
}

/** Apply fallback values to missing metrics */
export function applyFallbacks(metrics: Record<string, { used_pct: number | null; remaining_pct: number | null; resets: string | null }>): void {
  // Session fallbacks (5-hour window)
  if (metrics.session.used_pct === null) {
    metrics.session.used_pct = 0;
    metrics.session.remaining_pct = 100;
  }
  if (metrics.session.resets === null) {
    metrics.session.resets = calculateFallbackTime(5, true);
  }

  // Week (all models) fallbacks (7-day window)
  if (metrics.week_all.used_pct === null) {
    metrics.week_all.used_pct = 0;
    metrics.week_all.remaining_pct = 100;
  }
  if (metrics.week_all.resets === null) {
    metrics.week_all.resets = calculateFallbackTime(168, false);
  }

  // Week (Sonnet only) fallbacks
  if (metrics.week_sonnet.used_pct === null) {
    metrics.week_sonnet.used_pct = 0;
    metrics.week_sonnet.remaining_pct = 100;
  }
  if (metrics.week_sonnet.resets === null) {
    metrics.week_sonnet.resets = calculateFallbackTime(168, false);
  }
}

/** Parse complete Claude usage output.
 * Returns metrics dict and whether any usage regex actually matched.
 * When no regex matches (e.g. rate limit error), all values come from applyFallbacks(). */
export function parseClaudeOutput(output: string): MetricsDict & { __parsed: boolean } {
  const metrics = {
    session: parseSession(output),
    week_all: parseWeekAll(output),
    week_sonnet: parseWeekSonnet(output),
  };

  // Track whether any metric was actually parsed from real output
  const parsed = metrics.session.used_pct !== null
    || metrics.week_all.used_pct !== null
    || metrics.week_sonnet.used_pct !== null;

  applyFallbacks(metrics);

  const subscription = parseSubscription(output);

  return {
    subscription_type: subscription,
    __parsed: parsed,
    ...metrics,
  } as unknown as MetricsDict & { __parsed: boolean };
}
