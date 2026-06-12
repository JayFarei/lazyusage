/**
 * Deduplication tracker to avoid storing duplicate snapshots.
 * Ported from Python src/storage/database.py (DedupTracker class)
 */
import type { MetricsDict } from "../types.js";

export class DedupTracker {
  static readonly HEARTBEAT_INTERVAL = 60; // seconds

  private lastStored = new Map<string, [number, number]>();

  shouldStore(service: string, metricName: string, usedPct: number): boolean {
    const key = `${service}:${metricName}`;
    const now = Date.now() / 1000;

    const entry = this.lastStored.get(key);
    if (!entry) {
      this.lastStored.set(key, [usedPct, now]);
      return true;
    }

    const [lastPct, lastTime] = entry;

    if (usedPct !== lastPct) {
      this.lastStored.set(key, [usedPct, now]);
      return true;
    }

    if (now - lastTime >= DedupTracker.HEARTBEAT_INTERVAL) {
      this.lastStored.set(key, [usedPct, now]);
      return true;
    }

    return false;
  }

  shouldStoreMetrics(service: string, metrics: MetricsDict): boolean {
    for (const [metricName, metricData] of Object.entries(metrics)) {
      if (metricName === "subscription_type" || typeof metricData !== "object" || metricData === null) {
        continue;
      }
      const usedPct = metricData.used_pct ?? 0;
      if (this.shouldStore(service, metricName, usedPct)) {
        return true;
      }
    }
    return false;
  }

  clear(): void {
    this.lastStored.clear();
  }
}
