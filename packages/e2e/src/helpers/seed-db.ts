/**
 * Seed a test UsageStore database with realistic snapshot history
 * for E2E prediction testing.
 *
 * Creates 14 days of snapshots for Claude (week_all, week_sonnet, session)
 * and Codex (weekly, 5h) with realistic daily deltas and a window reset mid-period.
 */

import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { UsageStore } from "lazyusage-core";

const SEED_DB_DIR = join(import.meta.dir, "../../.test-data");
const SEED_DB_PATH = join(SEED_DB_DIR, "seeded-usage.db");

function getInternalDb(store: UsageStore): Database {
  return (store as unknown as { db: Database }).db;
}

/** Daily consumption pattern (% per day) for 14 days */
const DAILY_PATTERN = [8, 14, 2, 16, 5, 11, 18, 4, 12, 7, 3, 10, 6, 9];

/** Generate snapshots for a service/metric pair across 14 days */
function generateSnapshots(
  _service: "claude" | "codex",
  _metricName: string,
  baseTimestamp: number,
): Array<{
  timestamp: string;
  usedPct: number;
  remainingPct: number;
  resets: string;
  resetsAt: string;
}> {
  const snapshots: Array<{
    timestamp: string;
    usedPct: number;
    remainingPct: number;
    resets: string;
    resetsAt: string;
  }> = [];

  let cumulativeUsed = 0;
  const resetDay = 7; // Window resets on day 7

  // Reset time: 7 days from start at 2pm
  const resetTime = new Date(baseTimestamp + resetDay * 86400_000 + 14 * 3600_000);
  const resetsAtStr = resetTime.toISOString();
  const resetsHuman = formatResetTime(resetTime);

  for (let day = 0; day < 14; day++) {
    const dailyDelta = DAILY_PATTERN[day];

    if (day === resetDay) {
      // Day of reset: usage goes from cumulativeUsed to near-100, then resets
      // Morning snapshot (before reset)
      const morningTs = new Date(baseTimestamp + day * 86400_000 + 8 * 3600_000);
      snapshots.push({
        timestamp: morningTs.toISOString(),
        usedPct: Math.min(99, cumulativeUsed),
        remainingPct: Math.max(1, 100 - cumulativeUsed),
        resets: resetsHuman,
        resetsAt: resetsAtStr,
      });

      // After reset: usage drops to post-reset consumption
      cumulativeUsed = dailyDelta;
      const afternoonTs = new Date(baseTimestamp + day * 86400_000 + 16 * 3600_000);

      // New reset time: 7 more days
      const newResetTime = new Date(resetTime.getTime() + 7 * 86400_000);
      const newResetsAtStr = newResetTime.toISOString();
      const newResetsHuman = formatResetTime(newResetTime);

      snapshots.push({
        timestamp: afternoonTs.toISOString(),
        usedPct: cumulativeUsed,
        remainingPct: 100 - cumulativeUsed,
        resets: newResetsHuman,
        resetsAt: newResetsAtStr,
      });
      continue;
    }

    // Normal day: 3 snapshots (morning, midday, evening)
    const dayStart = cumulativeUsed;
    for (let snap = 0; snap < 3; snap++) {
      const hour = 8 + snap * 4; // 8am, 12pm, 4pm
      const ts = new Date(baseTimestamp + day * 86400_000 + hour * 3600_000);
      const progress = (snap + 1) / 3;
      const usedPct = Math.min(100, Math.round(dayStart + dailyDelta * progress));

      // Use the appropriate reset time
      const activeResetTime = day < resetDay ? resetTime : new Date(resetTime.getTime() + 7 * 86400_000);

      snapshots.push({
        timestamp: ts.toISOString(),
        usedPct,
        remainingPct: 100 - usedPct,
        resets: formatResetTime(activeResetTime),
        resetsAt: activeResetTime.toISOString(),
      });
    }

    cumulativeUsed = Math.min(100, cumulativeUsed + dailyDelta);
  }

  return snapshots;
}

function formatResetTime(dt: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hour = dt.getHours();
  const period = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 || 12;
  const minute = dt.getMinutes();
  const minuteStr = minute > 0 ? `:${String(minute).padStart(2, "0")}` : "";
  return `${months[dt.getMonth()]} ${dt.getDate()} at ${displayHour}${minuteStr}${period}`;
}

/** Create and seed a test database, returning its path. */
export function createSeededDatabase(): string {
  if (!existsSync(SEED_DB_DIR)) {
    mkdirSync(SEED_DB_DIR, { recursive: true });
  }

  // Remove old test db if exists
  if (existsSync(SEED_DB_PATH)) {
    unlinkSync(SEED_DB_PATH);
  }

  const store = new UsageStore(SEED_DB_PATH);

  // Start 14 days ago
  const baseTimestamp = Date.now() - 14 * 86400_000;

  // Claude snapshots
  for (const metric of ["week_all", "week_sonnet", "session"]) {
    const snapshots = generateSnapshots("claude", metric, baseTimestamp);
    for (const snap of snapshots) {
      const _metrics: Record<string, unknown> = {
        [metric]: {
          used_pct: snap.usedPct,
          remaining_pct: snap.remainingPct,
          resets: snap.resets,
        },
        subscription_type: "max",
      };
      // Use internal db to insert with specific timestamp and resets_at
      getInternalDb(store).run(
        `INSERT INTO usage_snapshots
          (timestamp, service, metric_name, used_pct, remaining_pct, resets, resets_at, subscription_type, source, collection_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snap.timestamp,
          "claude",
          metric,
          snap.usedPct,
          snap.remainingPct,
          snap.resets,
          snap.resetsAt,
          "max",
          "test",
          crypto.randomUUID(),
        ],
      );
    }
  }

  // Codex snapshots
  for (const metric of ["weekly", "5h"]) {
    const snapshots = generateSnapshots("codex", metric, baseTimestamp);
    for (const snap of snapshots) {
      getInternalDb(store).run(
        `INSERT INTO usage_snapshots
          (timestamp, service, metric_name, used_pct, remaining_pct, resets, resets_at, subscription_type, source, collection_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snap.timestamp,
          "codex",
          metric,
          snap.usedPct,
          snap.remainingPct,
          snap.resets,
          snap.resetsAt,
          "pro",
          "test",
          crypto.randomUUID(),
        ],
      );
    }
  }

  // Add a couple of supervised marks for tomorrow and day after
  const tomorrow = new Date(Date.now() + 86400_000);
  const dayAfter = new Date(Date.now() + 2 * 86400_000);
  store.setCapacityMark(tomorrow.toISOString().slice(0, 10), "L");
  store.setCapacityMark(dayAfter.toISOString().slice(0, 10), "H");

  store.close();
  return SEED_DB_PATH;
}

/** Return the path to the seeded database (create if needed). */
export function getSeededDbPath(): string {
  if (!existsSync(SEED_DB_PATH)) {
    return createSeededDatabase();
  }
  return SEED_DB_PATH;
}

export { SEED_DB_PATH };
