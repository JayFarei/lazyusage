/**
 * Fallback chain orchestrator for multi-source data fetching.
 * Port of src/providers/chain.py
 */

import { DataSource } from "../types.js";
import type { FetchResult, UsageProvider, PersistentUsageProvider, MetricsDict } from "../types.js";
import { UsageCache } from "./cache.js";
import { calculateFallbackTime } from "../utils/time.js";

/** Orchestrates fallback chain: API -> PTY -> Cache -> Default zeros */
export class FallbackChain {
  private service: string;
  private providers: UsageProvider[];
  private cache: UsageCache;
  private _lastResult: FetchResult | null = null;

  constructor(service: string, providers: UsageProvider[]) {
    this.service = service;
    this.providers = providers;
    this.cache = new UsageCache(service);
  }

  async fetch(): Promise<FetchResult> {
    // Try each provider in order
    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;

      const result = await provider.fetch();

      if (result.metrics !== null && result.error === null) {
        // Cache successful result
        this.cache.store(result.metrics, result.timestamp);
        this._lastResult = result;
        return result;
      }
    }

    // All providers failed, try cache
    const cacheResult = await this.cache.fetch();
    if (cacheResult.metrics !== null && cacheResult.error === null) {
      this._lastResult = cacheResult;
      return cacheResult;
    }

    // Return fallback zeros
    const fallbackResult = this._createFallbackResult();
    this._lastResult = fallbackResult;
    return fallbackResult;
  }

  getLastResult(): FetchResult | null {
    return this._lastResult;
  }

  private _createFallbackResult(): FetchResult {
    const metrics = this._createFallbackMetrics();
    return {
      metrics,
      source: DataSource.FALLBACK,
      timestamp: Date.now() / 1000,
      error: "All providers failed, using fallback zeros",
      stale: false,
    };
  }

  private _createFallbackMetrics(): MetricsDict {
    if (this.service === "claude") {
      return {
        subscription_type: "Unknown",
        session: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(5, true) },
        week_all: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(168, false) },
        week_sonnet: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(168, false) },
      };
    }
    // codex
    return {
      subscription_type: "Unknown",
      "5h": { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(5, true) },
      weekly: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(168, false) },
    };
  }
}

/** Fallback chain for persistent providers (used by TUI) */
export class PersistentFallbackChain {
  private service: string;
  private apiProvider: UsageProvider | null;
  private ptyProvider: PersistentUsageProvider;
  private cache: UsageCache;
  private _lastResult: FetchResult | null = null;
  private _ptyStarted = false;

  constructor(
    service: string,
    apiProvider: UsageProvider | null,
    ptyProvider: PersistentUsageProvider,
  ) {
    this.service = service;
    this.apiProvider = apiProvider;
    this.ptyProvider = ptyProvider;
    this.cache = new UsageCache(service);
  }

  async start(): Promise<FetchResult> {
    // Try API first (if available)
    if (this.apiProvider !== null && this.apiProvider.isAvailable()) {
      const result = await this.apiProvider.fetch();
      if (result.metrics !== null && result.error === null) {
        this.cache.store(result.metrics, result.timestamp);
        this._lastResult = result;
        return result;
      }
    }

    // Fallback to PTY
    const result = await this.ptyProvider.start();
    this._ptyStarted = true;

    if (result.metrics !== null && result.error === null) {
      this.cache.store(result.metrics, result.timestamp);
      this._lastResult = result;
      return result;
    }

    // Try cache as last resort
    const cacheResult = await this.cache.fetch();
    if (cacheResult.metrics !== null && cacheResult.error === null) {
      this._lastResult = cacheResult;
      return cacheResult;
    }

    // Return fallback
    const fallbackResult = this._createFallbackResult();
    this._lastResult = fallbackResult;
    return fallbackResult;
  }

  async refresh(): Promise<FetchResult> {
    // Try API first (if available)
    if (this.apiProvider !== null && this.apiProvider.isAvailable()) {
      const result = await this.apiProvider.fetch();
      if (result.metrics !== null && result.error === null) {
        this.cache.store(result.metrics, result.timestamp);
        this._lastResult = result;
        return result;
      }
    }

    // Fallback to PTY refresh
    if (!this._ptyStarted) {
      return this.start();
    }

    const result = await this.ptyProvider.refresh();

    if (result.metrics !== null && result.error === null && !result.stale) {
      this.cache.store(result.metrics, result.timestamp);
      this._lastResult = result;
      return result;
    }

    // If PTY failed or returned stale data, try cache
    const cacheResult = await this.cache.fetch();
    if (cacheResult.metrics !== null && cacheResult.error === null) {
      this._lastResult = cacheResult;
      return cacheResult;
    }

    // Return last good result if available
    if (this._lastResult !== null && this._lastResult.metrics !== null) {
      return {
        ...this._lastResult,
        stale: true,
      };
    }

    // Return fallback
    const fallbackResult = this._createFallbackResult();
    this._lastResult = fallbackResult;
    return fallbackResult;
  }

  async stop(): Promise<void> {
    if (this._ptyStarted) {
      await this.ptyProvider.stop();
      this._ptyStarted = false;
    }
  }

  getLastResult(): FetchResult | null {
    return this._lastResult;
  }

  private _createFallbackResult(): FetchResult {
    const metrics = this._createFallbackMetrics();
    return {
      metrics,
      source: DataSource.FALLBACK,
      timestamp: Date.now() / 1000,
      error: "All providers failed, using fallback zeros",
      stale: false,
    };
  }

  private _createFallbackMetrics(): MetricsDict {
    if (this.service === "claude") {
      return {
        subscription_type: "Unknown",
        session: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(5, true) },
        week_all: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(168, false) },
        week_sonnet: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(168, false) },
      };
    }
    return {
      subscription_type: "Unknown",
      "5h": { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(5, true) },
      weekly: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(168, false) },
    };
  }
}
