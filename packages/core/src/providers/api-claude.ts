/**
 * API-based Claude usage provider.
 * Port of ClaudeAPIProvider from src/providers/api.py
 */

import { DataSource } from "../types.js";
import type { FetchResult, UsageProvider, MetricsDict } from "../types.js";
import { ClaudeCredentialStore } from "./credentials.js";
import { formatResetFromIso } from "../utils/time.js";

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
      const response = await globalThis.fetch(ClaudeAPIProvider.API_URL, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "claude-code/2.0.32",
        },
        signal: AbortSignal.timeout(10000),
      });

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
