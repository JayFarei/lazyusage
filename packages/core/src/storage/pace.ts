/**
 * Hourly pace aggregator for usage trend visualization.
 * Reads from UsageStore snapshots and produces 168 hourly data points (1 week).
 */
import type { ServiceName } from "../types.js";
import { UsageStore } from "./database.js";

export interface PacePoint {
  hour: number;        // Unix timestamp (floored to hour)
  usedPct: number;     // Average used_pct for that hour
  sampleCount: number; // Number of snapshots in that hour
}

export interface PaceData {
  service: string;
  metricKey: string;
  points: PacePoint[];
}

/**
 * Build hourly pace data from stored snapshots.
 * Returns up to 168 points (7 days * 24 hours).
 */
export function buildPaceData(
  store: UsageStore,
  service: ServiceName,
  metricKey: string,
): PaceData {
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 3600_000;

  const history = store.getHistory(service, metricKey, 168); // 168 hours = 7 days
  const points: Map<number, { sum: number; count: number }> = new Map();

  for (const entry of history) {
    const ts = new Date(entry.timestamp).getTime();
    if (ts < weekAgo) continue;

    const usedPct = entry.used_pct;
    if (usedPct === undefined) continue;

    const hourFloor = Math.floor(ts / 3600_000) * 3600_000;
    const existing = points.get(hourFloor) ?? { sum: 0, count: 0 };
    existing.sum += usedPct;
    existing.count += 1;
    points.set(hourFloor, existing);
  }

  const sortedPoints: PacePoint[] = Array.from(points.entries())
    .sort(([a], [b]) => a - b)
    .map(([hour, { sum, count }]) => ({
      hour: hour / 1000, // back to unix seconds
      usedPct: Math.round(sum / count),
      sampleCount: count,
    }));

  return { service, metricKey, points: sortedPoints };
}
