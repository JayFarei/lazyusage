/**
 * Fallback chain orchestrator for multi-source data fetching.
 * Port of src/providers/chain.py
 */

import { DataSource } from "../types.js";
import type { FetchResult, UsageProvider, PersistentUsageProvider, MetricsDict } from "../types.js";
import { UsageCache } from "./cache.js";
import { calculateFallbackTime } from "../utils/time.js";
import { SESSION_WINDOW_HOURS, WEEKLY_WINDOW_HOURS } from "../constants.js";
import { ClaudeAPIProvider } from "./api-claude.js";
import { CodexAPIProvider } from "./api-codex.js";

/** Structured diagnostic event emitted during chain operations */
export interface ChainDiagnosticEvent {
  ts: string;
  service: string;
  phase: "start" | "refresh";
  step: string;
  provider?: string;
  source?: string;
  success?: boolean;
  error?: string;
  rateLimited?: boolean;
  stale?: boolean;
  detail?: string;
}

export type ChainDiagnosticListener = (event: ChainDiagnosticEvent) => void;

let _diagnosticListener: ChainDiagnosticListener | null = null;

/** Set a global diagnostic listener for chain events. Pass null to disable. */
export function setChainDiagnosticListener(listener: ChainDiagnosticListener | null): void {
  _diagnosticListener = listener;
}

function emitDiag(service: string, phase: "start" | "refresh", step: string, detail?: Partial<ChainDiagnosticEvent>): void {
  if (!_diagnosticListener) return;
  _diagnosticListener({
    ts: new Date().toISOString(),
    service,
    phase,
    step,
    ...detail,
  });
}

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

/** Type guard for persistent providers */
function isPersistentProvider(p: UsageProvider): p is PersistentUsageProvider {
  return "start" in p && "refresh" in p && "stop" in p;
}

/** Fallback chain for persistent providers (used by TUI) */
export class PersistentFallbackChain {
  private service: string;
  /** Non-persistent providers (API, Web, Session) - tried via fetch() */
  private immediateProviders: UsageProvider[];
  /** Persistent providers (PTY) - tried via start()/refresh()/stop() */
  private persistentProviders: PersistentUsageProvider[];
  private credStore: TokenRefreshable | undefined;
  private cache: UsageCache;
  private _lastResult: FetchResult | null = null;
  private _ptyStarted = false;

  // Legacy compat: keep references for getSourcePlan()
  private apiProvider: UsageProvider | null;
  private ptyProvider: PersistentUsageProvider;

  /**
   * Accepts either:
   * - Legacy: (service, apiProvider, ptyProvider, credStore?)
   * - New:    (service, providers[], credStore?)
   */
  constructor(
    service: string,
    apiProviderOrProviders: UsageProvider | UsageProvider[] | null,
    ptyProviderOrCredStore?: PersistentUsageProvider | TokenRefreshable,
    credStore?: TokenRefreshable,
  ) {
    this.service = service;
    this.cache = new UsageCache(service);

    if (Array.isArray(apiProviderOrProviders)) {
      // New multi-provider constructor
      const allProviders = apiProviderOrProviders;
      this.immediateProviders = allProviders.filter((p) => !isPersistentProvider(p));
      this.persistentProviders = allProviders.filter(isPersistentProvider);
      this.credStore = ptyProviderOrCredStore as TokenRefreshable | undefined;

      // Compat fields
      this.apiProvider = this.immediateProviders[0] ?? null;
      this.ptyProvider = this.persistentProviders[0] ?? null!;
    } else {
      // Legacy 2-provider constructor
      this.apiProvider = apiProviderOrProviders;
      this.ptyProvider = ptyProviderOrCredStore as PersistentUsageProvider;
      this.credStore = credStore;

      this.immediateProviders = this.apiProvider ? [this.apiProvider] : [];
      this.persistentProviders = [this.ptyProvider];
    }
  }

  /** Try each immediate provider, with token refresh after first failure */
  private async _tryImmediateProviders(phase: "start" | "refresh" = "refresh"): Promise<FetchResult | null> {
    let refreshAttempted = false;

    for (const provider of this.immediateProviders) {
      // Try the provider if available
      if (provider.isAvailable()) {
        emitDiag(this.service, phase, "try-immediate", { provider: provider.name, source: provider.sourceType });
        const result = await provider.fetch();
        if (result.metrics !== null && result.error === null) {
          emitDiag(this.service, phase, "immediate-ok", { provider: provider.name, source: result.source });
          this.cache.store(result.metrics, result.timestamp);
          this._lastResult = result;
          return result;
        }
        emitDiag(this.service, phase, "immediate-fail", { provider: provider.name, error: result.error ?? undefined });
      } else {
        emitDiag(this.service, phase, "immediate-skip", { provider: provider.name, detail: "not available" });
      }

      // Attempt token refresh once after first provider fails or is unavailable
      if (!refreshAttempted && this.credStore?.canRefresh()) {
        refreshAttempted = true;
        emitDiag(this.service, phase, "token-refresh-attempt");
        const refreshed = await this.credStore.tryRefreshToken();
        emitDiag(this.service, phase, "token-refresh-result", { success: refreshed });
        if (refreshed && provider.isAvailable()) {
          // Retry same provider after refresh (credentials may now be valid)
          const retryResult = await provider.fetch();
          if (retryResult.metrics !== null && retryResult.error === null) {
            emitDiag(this.service, phase, "immediate-ok-after-refresh", { provider: provider.name, source: retryResult.source });
            this.cache.store(retryResult.metrics, retryResult.timestamp);
            this._lastResult = retryResult;
            return retryResult;
          }
        }
      }
    }

    emitDiag(this.service, phase, "all-immediate-exhausted");
    return null;
  }

  async start(): Promise<FetchResult> {
    emitDiag(this.service, "start", "begin");
    const immediateResult = await this._tryImmediateProviders("start");
    if (immediateResult) return immediateResult;

    // Skip PTY when API is rate-limited (PTY's /usage and /status hit the same APIs)
    const rateLimited = this._isApiRateLimited();
    if (!rateLimited) {
      for (const provider of this.persistentProviders) {
        emitDiag(this.service, "start", "try-persistent", { provider: provider.name });
        const result = await provider.start();
        this._ptyStarted = true;

        if (result.metrics !== null && result.error === null && !result.stale) {
          emitDiag(this.service, "start", "persistent-ok", { provider: provider.name, source: result.source });
          this.cache.store(result.metrics, result.timestamp);
          this._lastResult = result;
          return result;
        }
        emitDiag(this.service, "start", "persistent-fail", { provider: provider.name, error: result.error ?? undefined, stale: result.stale });
      }
    } else {
      emitDiag(this.service, "start", "pty-skipped-ratelimit", { rateLimited: true });
    }

    // Prefer last good live result over cache (preserves original source label)
    if (this._lastResult !== null && this._lastResult.metrics !== null) {
      emitDiag(this.service, "start", "reuse-last-result", { source: this._lastResult.source, stale: true });
      return { ...this._lastResult, stale: true };
    }

    // Fall back to cache (covers cold start where _lastResult is null)
    const cacheResult = await this.cache.fetch();
    if (cacheResult.metrics !== null && cacheResult.error === null) {
      emitDiag(this.service, "start", "cache-hit", { source: DataSource.CACHE, stale: cacheResult.stale });
      return cacheResult;
    }

    emitDiag(this.service, "start", "fallback-zeros");
    const fallbackResult = this._createFallbackResult();
    return fallbackResult;
  }

  async refresh(): Promise<FetchResult> {
    emitDiag(this.service, "refresh", "begin");
    const immediateResult = await this._tryImmediateProviders("refresh");
    if (immediateResult) return immediateResult;

    // Skip PTY when API is rate-limited (PTY's /usage and /status hit the same APIs)
    const rateLimited = this._isApiRateLimited();
    if (!rateLimited) {
      if (!this._ptyStarted) {
        emitDiag(this.service, "refresh", "redirect-to-start", { detail: "PTY not started" });
        return this.start();
      }

      for (const provider of this.persistentProviders) {
        emitDiag(this.service, "refresh", "try-persistent", { provider: provider.name });
        const result = await provider.refresh();

        if (result.metrics !== null && result.error === null && !result.stale) {
          emitDiag(this.service, "refresh", "persistent-ok", { provider: provider.name, source: result.source });
          this.cache.store(result.metrics, result.timestamp);
          this._lastResult = result;
          return result;
        }
        emitDiag(this.service, "refresh", "persistent-fail", { provider: provider.name, error: result.error ?? undefined });
      }
    } else {
      emitDiag(this.service, "refresh", "pty-skipped-ratelimit", { rateLimited: true });
    }

    // Prefer last good live result over cache (preserves original source label).
    // The cache contains the same data (we stored it on success), but stamped as
    // DataSource.CACHE which is misleading when the data is still recent.
    if (this._lastResult !== null && this._lastResult.metrics !== null) {
      emitDiag(this.service, "refresh", "reuse-last-result", { source: this._lastResult.source, stale: true });
      return { ...this._lastResult, stale: true };
    }

    // Fall back to cache (covers cold start where _lastResult is null)
    const cacheResult = await this.cache.fetch();
    if (cacheResult.metrics !== null && cacheResult.error === null) {
      emitDiag(this.service, "refresh", "cache-hit", { source: DataSource.CACHE, stale: cacheResult.stale });
      return cacheResult;
    }

    emitDiag(this.service, "refresh", "fallback-zeros");
    const fallbackResult = this._createFallbackResult();
    this._lastResult = fallbackResult;
    return fallbackResult;
  }

  async stop(): Promise<void> {
    if (this._ptyStarted) {
      for (const provider of this.persistentProviders) {
        await provider.stop();
      }
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

  /**
   * Check if the PTY should be skipped due to API rate limiting.
   * Claude CLI's /usage command uses an internal endpoint independent of the
   * OAuth usage API, so PTY is never skipped for Claude.
   * Codex CLI's /status may share the same rate limit as the API.
   */
  private _isApiRateLimited(): boolean {
    if (this.service === "codex") return CodexAPIProvider.isRateLimited();
    return false;
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
