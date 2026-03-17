/**
 * API-based Claude usage provider.
 * Port of ClaudeAPIProvider from src/providers/api.py
 */

import { DataSource } from "../types.js";
import type { FetchResult, UsageProvider, MetricsDict } from "../types.js";
import { ClaudeCredentialStore } from "./credentials.js";
import { formatResetFromIso } from "../utils/time.js";
import { API_TIMEOUT_MS, RATE_LIMIT_DEFAULT_SECONDS } from "../constants.js";

const PACKAGE_VERSION = "0.1.0"; // from @lazyusage/core package.json

export class ClaudeAPIProvider implements UsageProvider {
  static readonly API_URL = "https://api.anthropic.com/api/oauth/usage";

  name = "ClaudeAPIProvider";
  sourceType = DataSource.API;

  private _credentialsStore: ClaudeCredentialStore;

  constructor(credentialsStore?: ClaudeCredentialStore) {
    this._credentialsStore = credentialsStore ?? new ClaudeCredentialStore();
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
      let response = await this._fetchWithRetry(creds.accessToken);

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
      const metrics = this._parseApiResponse(data as Record<string, unknown>, creds.subscriptionType);

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

  /**
   * Track when the rate limit window expires so we skip requests that will 429.
   * The usage endpoint allows ~1 req per 3-4 min.
   */
  private static _rateLimitedUntil = 0;

  private async _fetchWithRetry(accessToken: string): Promise<Response> {
    // Skip if we know we're still rate-limited
    if (Date.now() < ClaudeAPIProvider._rateLimitedUntil) {
      const secsLeft = Math.ceil((ClaudeAPIProvider._rateLimitedUntil - Date.now()) / 1000);
      return new Response(
        JSON.stringify({ error: { message: "Rate limited (cached)", type: "rate_limit_error" } }),
        { status: 429, statusText: `Too Many Requests (retry in ${secsLeft}s)` },
      );
    }

    const response = await globalThis.fetch(ClaudeAPIProvider.API_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": `lazyusage/${PACKAGE_VERSION}`,
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get("retry-after") ?? String(RATE_LIMIT_DEFAULT_SECONDS), 10);
      ClaudeAPIProvider._rateLimitedUntil = Date.now() + retryAfter * 1000;
    }

    return response;
  }

  private _parseApiResponse(data: Record<string, unknown>, subscriptionType: string): MetricsDict {
    const fiveHour = (data.five_hour ?? {}) as Record<string, unknown>;
    const sevenDay = (data.seven_day ?? {}) as Record<string, unknown>;
    const sevenDaySonnet = (data.seven_day_sonnet ?? {}) as Record<string, unknown>;

    const getUtilization = (window: Record<string, unknown>): number => {
      const util = window.utilization;
      if (util === null || util === undefined) return 0;
      return Math.round(Number(util));
    };

    const sessionUsed = getUtilization(fiveHour);
    const weekAllUsed = getUtilization(sevenDay);
    const weekSonnetUsed = getUtilization(sevenDaySonnet);

    return {
      subscription_type: subscriptionType,
      session: {
        used_pct: sessionUsed,
        remaining_pct: 100 - sessionUsed,
        resets: formatResetFromIso((fiveHour.resets_at as string) ?? ""),
      },
      week_all: {
        used_pct: weekAllUsed,
        remaining_pct: 100 - weekAllUsed,
        resets: formatResetFromIso((sevenDay.resets_at as string) ?? ""),
      },
      week_sonnet: {
        used_pct: weekSonnetUsed,
        remaining_pct: 100 - weekSonnetUsed,
        resets: formatResetFromIso((sevenDaySonnet.resets_at as string) ?? ""),
      },
    };
  }
}
