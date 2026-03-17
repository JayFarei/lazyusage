/**
 * Fallback chain orchestrator for multi-source data fetching.
 * Port of src/providers/chain.py
 */

import { DataSource } from "../types.js";
import type { FetchResult, UsageProvider, PersistentUsageProvider, MetricsDict } from "../types.js";
import { UsageCache } from "./cache.js";
import { calculateFallbackTime } from "../utils/time.js";
import { SESSION_WINDOW_HOURS, WEEKLY_WINDOW_HOURS } from "../constants.js";

/** Minimal interface for token refresh - allows test injection without importing ClaudeCredentialStore */
export interface TokenRefreshable {
  canRefresh(): boolean;
  tryRefreshToken(oauthUrl?: string): Promise<boolean>;
}

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
    // Try each provider in order (API -> PTY -> etc.)
    // On failure (including 429), continue to next provider.
    // ClaudeAPIProvider._rateLimitedUntil handles fast 429 skips internally.
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
      error: "Unable to fetch usage data",
      stale: false,
    };
  }

  private _createFallbackMetrics(): MetricsDict {
    if (this.service === "claude") {
      return {
        subscription_type: "Unknown",
        session: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(SESSION_WINDOW_HOURS, true) },
        week_all: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(WEEKLY_WINDOW_HOURS, false) },
        week_sonnet: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(WEEKLY_WINDOW_HOURS, false) },
      };
    }
    // codex
    return {
      subscription_type: "Unknown",
      "5h": { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(SESSION_WINDOW_HOURS, true) },
      weekly: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(WEEKLY_WINDOW_HOURS, false) },
    };
  }
}

/** Describes the availability of each data source and the recommended fetch order */
export interface SourcePlan {
  sources: Array<{ name: string; type: string; available: boolean }>;
  recommended: string[];
}

/** Probes source availability and returns an ordered execution plan */
export class SourcePlanner {
  constructor(
    private apiProvider: UsageProvider | null,
    private ptyAvailable: boolean,
    private cacheAvailable: boolean,
    private credStore?: TokenRefreshable,
  ) {}

  plan(): SourcePlan {
    const sources: SourcePlan["sources"] = [];

    const apiAvail = this.apiProvider?.isAvailable() ?? false;
    sources.push({ name: "api", type: "api", available: apiAvail });

    if (this.credStore?.canRefresh()) {
      sources.push({ name: "api-refresh", type: "api", available: true });
    }

    sources.push({ name: "pty", type: "pty", available: this.ptyAvailable });
    sources.push({ name: "cache", type: "cache", available: this.cacheAvailable });

    const recommended = sources
      .filter((s) => s.available)
      .map((s) => s.name);

    return { sources, recommended };
  }
}

/** Fallback chain for persistent providers (used by TUI) */
export class PersistentFallbackChain {
  private service: string;
  private apiProvider: UsageProvider | null;
  private ptyProvider: PersistentUsageProvider;
  private credStore: TokenRefreshable | undefined;
  private cache: UsageCache;
  private _lastResult: FetchResult | null = null;
  private _ptyStarted = false;

  constructor(
    service: string,
    apiProvider: UsageProvider | null,
    ptyProvider: PersistentUsageProvider,
    credStore?: TokenRefreshable,
  ) {
    this.service = service;
    this.apiProvider = apiProvider;
    this.ptyProvider = ptyProvider;
    this.credStore = credStore;
    this.cache = new UsageCache(service);
  }

  /** Attempt API fetch, with optional OAuth token refresh on failure */
  private async _tryApiWithRefresh(): Promise<FetchResult | null> {
    // Try API first
    if (this.apiProvider !== null && this.apiProvider.isAvailable()) {
      const result = await this.apiProvider.fetch();
      if (result.metrics !== null && result.error === null) {
        this.cache.store(result.metrics, result.timestamp);
        this._lastResult = result;
        return result;
      }
    }

    // Attempt OAuth token refresh before falling back
    if (this.credStore?.canRefresh()) {
      const refreshed = await this.credStore.tryRefreshToken();
      if (refreshed && this.apiProvider?.isAvailable()) {
        const retryResult = await this.apiProvider!.fetch();
        if (retryResult.metrics !== null && retryResult.error === null) {
          this.cache.store(retryResult.metrics, retryResult.timestamp);
          this._lastResult = retryResult;
          return retryResult;
        }
      }
    }

    return null; // API path exhausted
  }

  async start(): Promise<FetchResult> {
    const apiResult = await this._tryApiWithRefresh();
    if (apiResult) return apiResult;

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

    const fallbackResult = this._createFallbackResult();
    this._lastResult = fallbackResult;
    return fallbackResult;
  }

  async refresh(): Promise<FetchResult> {
    const apiResult = await this._tryApiWithRefresh();
    if (apiResult) return apiResult;

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
      return { ...this._lastResult, stale: true };
    }

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

  getSourcePlan(): SourcePlan {
    const planner = new SourcePlanner(
      this.apiProvider,
      true, // PTY is always potentially available
      true, // Cache is always available
      this.credStore,
    );
    return planner.plan();
  }

  private _createFallbackResult(): FetchResult {
    const metrics = this._createFallbackMetrics();
    return {
      metrics,
      source: DataSource.FALLBACK,
      timestamp: Date.now() / 1000,
      error: "Unable to fetch usage data",
      stale: false,
    };
  }

  private _createFallbackMetrics(): MetricsDict {
    if (this.service === "claude") {
      return {
        subscription_type: "Unknown",
        session: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(SESSION_WINDOW_HOURS, true) },
        week_all: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(WEEKLY_WINDOW_HOURS, false) },
        week_sonnet: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(WEEKLY_WINDOW_HOURS, false) },
      };
    }
    return {
      subscription_type: "Unknown",
      "5h": { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(SESSION_WINDOW_HOURS, true) },
      weekly: { used_pct: 0, remaining_pct: 100, resets: calculateFallbackTime(WEEKLY_WINDOW_HOURS, false) },
    };
  }
}
