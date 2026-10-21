/**
 * API-based Grok Build usage provider.
 *
 * Reads the same endpoint the grok CLI's `/usage` modal uses. It is not a
 * documented public API, so parsing is defensive and any shape change surfaces
 * as a provider error (the chain then falls back to cache).
 */

import { API_TIMEOUT_MS, GROK_API_MIN_INTERVAL_MS, GROK_RATE_LIMIT_DEFAULT_SECONDS } from "../constants.js";
import type { FetchResult, MetricData, MetricsDict, UsageProvider } from "../types.js";
import { DataSource } from "../types.js";
import { formatResetFromIso } from "../utils/time.js";
import { GrokCredentialStore } from "./credentials.js";
import type { GrokBotMetricSource } from "./grok-bot.js";

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
  const resets = formatResetFromIso(period.end);
  const bot = botMetric(config as Record<string, unknown>, resets);
  return {
    subscription_type: subscription,
    weekly: { used_pct: used, remaining_pct: 100 - used, resets },
    ...(bot ? { bot } : {}),
  };
}

/**
 * Grok Bot's share of the weekly pool, shown as its own bar the way Fable is.
 * A missing product entry means the plan did not report one.
 */
function botMetric(config: Record<string, unknown>, resets: string): MetricData | undefined {
  const raw = config.productUsage;
  if (!Array.isArray(raw)) return undefined;
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.product !== "GrokBot") continue;
    const pct = record.usagePercent;
    if (typeof pct !== "number" || !Number.isFinite(pct)) return undefined;
    const used = Math.min(100, Math.max(0, Math.round(pct)));
    return { used_pct: used, remaining_pct: 100 - used, resets };
  }
  return undefined;
}

export class GrokAPIProvider implements UsageProvider {
  static readonly API_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

  name = "GrokAPIProvider";
  sourceType = DataSource.API;

  private _credentialsStore: GrokCredentialStore;
  private _bot: GrokBotMetricSource | null;

  /**
   * Last successful fetch, shared across instances: `--live`, the server and SSE build a
   * fresh chain per poll, so a per-instance cache would never throttle them.
   */
  private static _lastSuccess: { at: number; metrics: MetricsDict } | null = null;

  private static _rateLimitedUntil = 0;

  static isRateLimited(): boolean {
    return Date.now() < GrokAPIProvider._rateLimitedUntil;
  }

  constructor(credentialsStore?: GrokCredentialStore, bot: GrokBotMetricSource | null = null) {
    this._credentialsStore = credentialsStore ?? new GrokCredentialStore();
    this._bot = bot;
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
      await attachGrokBotMetric(metrics, this._bot);

      GrokAPIProvider._lastSuccess = { at: Date.now(), metrics };
      return result(metrics, null);
    } catch (e) {
      return result(null, `API request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Adds the Bot bar when that allowance is separate. A Bot failure leaves the Grok pool as it was. */
async function attachGrokBotMetric(metrics: MetricsDict, bot: GrokBotMetricSource | null): Promise<void> {
  if (bot === null) return;
  let metric: MetricData | null = null;
  try {
    metric = await bot.metric();
  } catch {
    return;
  }
  if (metric !== null) metrics.bot = metric;
}
