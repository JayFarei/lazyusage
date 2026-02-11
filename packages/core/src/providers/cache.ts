/**
 * Filesystem-based cache for last-good usage data.
 * Port of src/providers/cache.py
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { DataSource } from "../types.js";
import type { FetchResult, UsageProvider, MetricsDict } from "../types.js";

export class UsageCache implements UsageProvider {
  static readonly CACHE_DIR = join(homedir(), ".cache", "usage-cli");
  static readonly STALE_THRESHOLD = 300; // 5 minutes

  name = "UsageCache";
  sourceType = DataSource.CACHE;

  private cacheFile: string;

  constructor(service: string) {
    this.cacheFile = join(UsageCache.CACHE_DIR, `${service}.json`);

    // Ensure cache directory exists
    if (!existsSync(UsageCache.CACHE_DIR)) {
      mkdirSync(UsageCache.CACHE_DIR, { recursive: true });
    }
  }

  isAvailable(): boolean {
    return existsSync(this.cacheFile);
  }

  async fetch(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;

    if (!existsSync(this.cacheFile)) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: "Cache file does not exist",
        stale: false,
      };
    }

    try {
      const raw = readFileSync(this.cacheFile, "utf-8");
      const data = JSON.parse(raw) as { timestamp: number; metrics: MetricsDict };

      const cachedTimestamp = data.timestamp ?? 0;
      const metrics = data.metrics;

      const age = timestamp - cachedTimestamp;
      const isStale = age > UsageCache.STALE_THRESHOLD;

      return {
        metrics,
        source: this.sourceType,
        timestamp: cachedTimestamp,
        error: null,
        stale: isStale,
      };
    } catch (e) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: `Failed to read cache: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }

  store(metrics: MetricsDict, timestamp: number): void {
    try {
      const data = { timestamp, metrics };
      writeFileSync(this.cacheFile, JSON.stringify(data, null, 2));
    } catch {
      // Silently fail, cache is best-effort
    }
  }

  clear(): void {
    try {
      if (existsSync(this.cacheFile)) {
        unlinkSync(this.cacheFile);
      }
    } catch {
      // Silently fail
    }
  }
}
