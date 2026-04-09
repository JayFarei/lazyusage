/**
 * Web API-based Claude usage provider.
 * Fetches usage from claude.ai/api using browser session cookies.
 * Independent rate limit from the OAuth API endpoint.
 * macOS only (browser cookie extraction requires Keychain access).
 */

import { DataSource } from "../types.js";
import type { FetchResult, UsageProvider, MetricsDict } from "../types.js";
import { formatResetFromIso } from "../utils/time.js";
import { API_TIMEOUT_MS } from "../constants.js";
import {
  getClaudeSessionCookie as _getClaudeSessionCookie,
  invalidateClaudeSessionCookie as _invalidateClaudeSessionCookie,
  type SessionCookie,
} from "../utils/cookies.js";

const WEB_RATE_LIMIT_DEFAULT_SECONDS = 60;

export interface CookieAccessor {
  get(): SessionCookie | null;
  invalidate(): void;
}

export class ClaudeWebProvider implements UsageProvider {
  static readonly BASE_URL = "https://claude.ai/api";

  name = "ClaudeWebProvider";
  sourceType = DataSource.WEB;

  private static _rateLimitedUntil = 0;
  private _orgId: string | null = null;
  private _cookies: CookieAccessor;

  constructor(cookies?: CookieAccessor) {
    this._cookies = cookies ?? {
      get: _getClaudeSessionCookie,
      invalidate: _invalidateClaudeSessionCookie,
    };
  }

  static isRateLimited(): boolean {
    return Date.now() < ClaudeWebProvider._rateLimitedUntil;
  }

  isAvailable(): boolean {
    if (process.platform !== "darwin") return false;
    if (ClaudeWebProvider.isRateLimited()) return false;
    return this._cookies.get() !== null;
  }

  async fetch(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;

    const cookie = this._cookies.get();
    if (!cookie) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: "No Claude session cookie found in browsers",
        stale: false,
      };
    }

    try {
      // Resolve org ID if not cached
      if (!this._orgId) {
        this._orgId = await this._fetchOrgId(cookie.value);
        if (!this._orgId) {
          return {
            metrics: null,
            source: this.sourceType,
            timestamp,
            error: "Could not resolve Claude organization",
            stale: false,
          };
        }
      }

      // Fetch usage
      const response = await globalThis.fetch(
        `${ClaudeWebProvider.BASE_URL}/organizations/${this._orgId}/usage`,
        {
          method: "GET",
          headers: {
            Cookie: `sessionKey=${cookie.value}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );

      if (response.status === 401 || response.status === 403) {
        this._cookies.invalidate();
        this._orgId = null;
        return {
          metrics: null,
          source: this.sourceType,
          timestamp,
          error: `Web API unauthorized (${response.status}), session expired`,
          stale: false,
        };
      }

      if (response.status === 429) {
        const retryAfter = parseInt(
          response.headers.get("retry-after") ?? String(WEB_RATE_LIMIT_DEFAULT_SECONDS),
          10,
        );
        ClaudeWebProvider._rateLimitedUntil = Date.now() + retryAfter * 1000;
        return {
          metrics: null,
          source: this.sourceType,
          timestamp,
          error: `Web API rate limited (retry in ${retryAfter}s)`,
          stale: false,
        };
      }

      if (!response.ok) {
        return {
          metrics: null,
          source: this.sourceType,
          timestamp,
          error: `Web API error: ${response.status} ${response.statusText}`,
          stale: false,
        };
      }

      const data = (await response.json()) as Record<string, unknown>;
      const metrics = this._parseResponse(data);

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
        error: `Web API failed: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }

  private async _fetchOrgId(sessionKey: string): Promise<string | null> {
    try {
      const response = await globalThis.fetch(
        `${ClaudeWebProvider.BASE_URL}/organizations`,
        {
          method: "GET",
          headers: {
            Cookie: `sessionKey=${sessionKey}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this._cookies.invalidate();
        }
        return null;
      }

      const orgs = (await response.json()) as Array<Record<string, unknown>>;
      if (!Array.isArray(orgs) || orgs.length === 0) return null;

      // Prefer org with chat capability, like CodexBar does
      const chatOrg = orgs.find((o) => {
        const caps = o.capabilities as string[] | undefined;
        return caps?.includes("chat");
      });
      const selected = chatOrg ?? orgs[0];
      return (selected.uuid as string) ?? null;
    } catch {
      return null;
    }
  }

  /** Parse usage response, same shape as OAuth API */
  private _parseResponse(data: Record<string, unknown>): MetricsDict {
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
      subscription_type: "Unknown", // Web API doesn't return subscription type
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
