/**
 * API-based Grok Build usage provider.
 *
 * Reads the same endpoint the grok CLI's `/usage` modal uses. It is not a
 * documented public API, so parsing is defensive and any shape change surfaces
 * as a provider error (the chain then falls back to cache).
 */

import { API_TIMEOUT_MS, GROK_API_MIN_INTERVAL_MS, GROK_RATE_LIMIT_DEFAULT_SECONDS } from "../constants.js";
import type { FetchResult, MetricsDict, UsageProvider } from "../types.js";
import { DataSource } from "../types.js";
import { formatResetFromIso } from "../utils/time.js";
import { GrokCredentialStore } from "./credentials.js";

/**
 * Parse the `/v1/billing?format=credits` body into a MetricsDict.
 * Returns null when the period is not the weekly pool this metric models.
 * proto3 JSON omits zero values, so a missing `creditUsagePercent` means 0%.
 */
export function parseGrokBillingResponse(
  data: Record<string, unknown>,
  subscription: string | null = null,
): MetricsDict | null {
  const config = data.config;
  if (config === null || typeof config !== "object") return null;
  const { currentPeriod, creditUsagePercent } = config as Record<string, unknown>;
  if (currentPeriod === null || typeof currentPeriod !== "object") return null;
  const period = currentPeriod as Record<string, unknown>;
  if (period.type !== "USAGE_PERIOD_TYPE_WEEKLY" || typeof period.end !== "string") return null;

  const raw = typeof creditUsagePercent === "number" && Number.isFinite(creditUsagePercent) ? creditUsagePercent : 0;
  const used = Math.min(100, Math.max(0, Math.round(raw)));
  return {
    subscription_type: subscription,
    weekly: { used_pct: used, remaining_pct: 100 - used, resets: formatResetFromIso(period.end) },
  };
}

export class GrokAPIProvider implements UsageProvider {
  static readonly API_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

  name = "GrokAPIProvider";
  sourceType = DataSource.API;

  private _credentialsStore: GrokCredentialStore;

  /**
   * Last successful fetch, shared across instances: `--live`, the server and SSE build a
   * fresh chain per poll, so a per-instance cache would never throttle them.
   */
  private static _lastSuccess: { at: number; metrics: MetricsDict } | null = null;

  private static _rateLimitedUntil = 0;

  static isRateLimited(): boolean {
    return Date.now() < GrokAPIProvider._rateLimitedUntil;
  }

  constructor(credentialsStore?: GrokCredentialStore) {
    this._credentialsStore = credentialsStore ?? new GrokCredentialStore();
  }

  isAvailable(): boolean {
    return this._credentialsStore.isAvailable();
  }

  async fetch(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;
    const result = (metrics: MetricsDict | null, error: string | null): FetchResult => ({
      metrics,
      source: this.sourceType,
      timestamp,
      error,
      stale: false,
    });

    const creds = this._credentialsStore.getCredentials();
    if (creds === null) return result(null, "No credentials available");

    const last = GrokAPIProvider._lastSuccess;
    if (last !== null && Date.now() - last.at < GROK_API_MIN_INTERVAL_MS) {
      return result(last.metrics, null);
    }

    if (GrokAPIProvider.isRateLimited()) {
      const secsLeft = Math.ceil((GrokAPIProvider._rateLimitedUntil - Date.now()) / 1000);
      return result(null, `API request failed: 429 Too Many Requests (retry in ${secsLeft}s)`);
    }

    try {
      const response = await globalThis.fetch(GrokAPIProvider.API_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${creds.accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });

      if (response.status === 429) {
        const parsed = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
        const retryAfter = parsed > 0 ? parsed : GROK_RATE_LIMIT_DEFAULT_SECONDS;
        GrokAPIProvider._rateLimitedUntil = Date.now() + retryAfter * 1000;
      }
      if (!response.ok) {
        return result(null, `API request failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      const metrics = parseGrokBillingResponse(data, this._credentialsStore.getSubscription());
      if (metrics === null) return result(null, "Unrecognized Grok billing response (no weekly period)");

      GrokAPIProvider._lastSuccess = { at: Date.now(), metrics };
      return result(metrics, null);
    } catch (e) {
      return result(null, `API request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
