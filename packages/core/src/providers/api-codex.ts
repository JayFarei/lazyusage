/**
 * API-based Codex usage provider.
 * Port of CodexAPIProvider from src/providers/api.py
 */

import { DataSource } from "../types.js";
import type { FetchResult, UsageProvider, MetricsDict } from "../types.js";
import { CodexCredentialStore } from "./credentials.js";
import { formatResetFromIso } from "../utils/time.js";
import { API_TIMEOUT_MS, CODEX_PLAN_TYPE_MAP, CODEX_RATE_LIMIT_DEFAULT_SECONDS } from "../constants.js";

export class CodexAPIProvider implements UsageProvider {
  static readonly API_URL = "https://chatgpt.com/backend-api/wham/usage";

  name = "CodexAPIProvider";
  sourceType = DataSource.API;

  private _credentialsStore = new CodexCredentialStore();

  /**
   * Track when the rate limit window expires so we skip requests that will 429.
   */
  private static _rateLimitedUntil = 0;

  /** Check if the usage API is currently rate-limited. */
  static isRateLimited(): boolean {
    return Date.now() < CodexAPIProvider._rateLimitedUntil;
  }

  isAvailable(): boolean {
    return this._credentialsStore.isAvailable();
  }

  async fetch(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;

    const creds = this._credentialsStore.getCredentials();
    if (creds === null) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: "No credentials available",
        stale: false,
      };
    }

    try {
      const response = await this._fetchWithRetry(creds.accessToken);

      if (!response.ok) {
        return {
          metrics: null,
          source: this.sourceType,
          timestamp,
          error: `API request failed: ${response.status} ${response.statusText}`,
          stale: false,
        };
      }

      const data = await response.json();
      const metrics = this._parseApiResponse(data as Record<string, unknown>);

      return {
        metrics,
        source: this.sourceType,
        timestamp,
        error: null,
        stale: false,
      };
    } catch (e) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: `API request failed: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }

  private async _fetchWithRetry(accessToken: string): Promise<Response> {
    // Skip if we know we're still rate-limited
    if (Date.now() < CodexAPIProvider._rateLimitedUntil) {
      const secsLeft = Math.ceil((CodexAPIProvider._rateLimitedUntil - Date.now()) / 1000);
      return new Response(
        JSON.stringify({ error: { message: "Rate limited (cached)", type: "rate_limit_error" } }),
        { status: 429, statusText: `Too Many Requests (retry in ${secsLeft}s)` },
      );
    }

    const response = await globalThis.fetch(CodexAPIProvider.API_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (response.status === 429) {
      const parsed = parseInt(response.headers.get("retry-after") ?? "", 10);
      const retryAfter = parsed > 0 ? parsed : CODEX_RATE_LIMIT_DEFAULT_SECONDS;
      CodexAPIProvider._rateLimitedUntil = Date.now() + retryAfter * 1000;
    }

    return response;
  }

  private _parseApiResponse(data: Record<string, unknown>): MetricsDict {
    const rateLimit = (data.rate_limit ?? {}) as Record<string, unknown>;
    const primary = (rateLimit.primary_window ?? {}) as Record<string, unknown>;
    const secondary = (rateLimit.secondary_window ?? {}) as Record<string, unknown>;
    const plan = (data.plan_type as string) ?? "unknown";

    const getPercent = (window: Record<string, unknown>): number => {
      const pct = window.used_percent;
      if (pct === null || pct === undefined) return 0;
      return Math.round(Number(pct));
    };

    const unixToIso = (timestamp: unknown): string => {
      if (timestamp === null || timestamp === undefined) return "";
      try {
        const dt = new Date(Number(timestamp) * 1000);
        return dt.toISOString();
      } catch {
        return "";
      }
    };

    const fiveHourUsed = getPercent(primary);
    const weeklyUsed = getPercent(secondary);

    return {
      subscription_type: CODEX_PLAN_TYPE_MAP[plan] ?? plan,
      "5h": {
        used_pct: fiveHourUsed,
        remaining_pct: 100 - fiveHourUsed,
        resets: formatResetFromIso(unixToIso(primary.reset_at)),
      },
      weekly: {
        used_pct: weeklyUsed,
        remaining_pct: 100 - weeklyUsed,
        resets: formatResetFromIso(unixToIso(secondary.reset_at)),
      },
    };
  }
}
