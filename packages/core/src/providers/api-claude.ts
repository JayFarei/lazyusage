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
   * The Anthropic usage API sends Retry-After: 0 on 429, so we use exponential
   * backoff: 4min → 8min → 16min (capped at 20min).
   */
  private static _rateLimitedUntil = 0;
  private static _consecutive429s = 0;
  private static readonly MAX_BACKOFF_SECONDS = 1200; // 20 minutes

  /** Check if the usage API is currently rate-limited.
   * Also applies to PTY since `/usage` uses the same API under the hood. */
  static isRateLimited(): boolean {
    return Date.now() < ClaudeAPIProvider._rateLimitedUntil;
  }

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
      ClaudeAPIProvider._consecutive429s++;
      const rawHeader = response.headers.get("retry-after");
      const parsed = parseInt(rawHeader ?? "", 10);
      // Exponential backoff when header is missing/zero (API sends Retry-After: 0).
      // Base = 240s, doubles per consecutive 429, capped at 20 min.
      const backoff = parsed > 0
        ? parsed
        : Math.min(
            RATE_LIMIT_DEFAULT_SECONDS * Math.pow(2, ClaudeAPIProvider._consecutive429s - 1),
            ClaudeAPIProvider.MAX_BACKOFF_SECONDS,
          );
      ClaudeAPIProvider._rateLimitedUntil = Date.now() + backoff * 1000;
    } else if (response.ok) {
      ClaudeAPIProvider._consecutive429s = 0;
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
