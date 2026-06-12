/**
 * Unit tests for detectWarning and detectLimitAdjustment from warnings.ts.
 */
import { describe, expect, test } from "bun:test";
import type { FetchResult, MetricsDict } from "../../packages/core/src/types.js";
import { DataSource } from "../../packages/core/src/types.js";
import { detectLimitAdjustment, detectWarning } from "../../packages/core/src/utils/warnings.js";

// ---------------------------------------------------------------------------
// detectWarning
// ---------------------------------------------------------------------------

describe("detectWarning", () => {
  test("returns null for successful API result (no error, source=API)", () => {
    const result: FetchResult = {
      metrics: { session: { used_pct: 10, remaining_pct: 90, resets: "2h" } },
      source: DataSource.API,
      timestamp: Date.now() / 1000,
      error: null,
      stale: false,
    };
    expect(detectWarning("claude", result)).toBeNull();
  });

  test("returns null for 429 rate limit errors (suppressed)", () => {
    const result: FetchResult = {
      metrics: null,
      source: DataSource.API,
      timestamp: Date.now() / 1000,
      error: "API request failed: 429 Too Many Requests",
      stale: false,
    };
    expect(detectWarning("claude", result)).toBeNull();
  });

  test("returns null for rate_limit pattern errors (suppressed)", () => {
    const result: FetchResult = {
      metrics: null,
      source: DataSource.API,
      timestamp: Date.now() / 1000,
      error: "Rate limit exceeded",
      stale: false,
    };
    expect(detectWarning("claude", result)).toBeNull();
  });

  test("returns auth warning for 401 errors", () => {
    const result: FetchResult = {
      metrics: null,
      source: DataSource.API,
      timestamp: Date.now() / 1000,
      error: "API request failed: 401 Unauthorized",
      stale: false,
    };
    const warning = detectWarning("claude", result);
    expect(warning).not.toBeNull();
    expect(warning?.service).toBe("claude");
    expect(warning?.message).toContain("auth expired");
    expect(warning?.action).toContain("claude");
  });

  test("returns auth warning for 'token expired' errors", () => {
    const result: FetchResult = {
      metrics: null,
      source: DataSource.API,
      timestamp: Date.now() / 1000,
      error: "token expired",
      stale: false,
    };
    const warning = detectWarning("claude", result);
    expect(warning).not.toBeNull();
    expect(warning?.message).toContain("auth expired");
  });

  test("returns codex-specific action for codex service auth error", () => {
    const result: FetchResult = {
      metrics: null,
      source: DataSource.API,
      timestamp: Date.now() / 1000,
      error: "401 Unauthorized",
      stale: false,
    };
    const warning = detectWarning("codex", result);
    expect(warning).not.toBeNull();
    expect(warning?.action).toContain("codex login");
  });

  test("returns 'data unavailable' for FALLBACK with 'All providers failed'", () => {
    const result: FetchResult = {
      metrics: null,
      source: DataSource.FALLBACK,
      timestamp: Date.now() / 1000,
      error: "All providers failed, using fallback zeros",
      stale: false,
    };
    const warning = detectWarning("claude", result);
    expect(warning).not.toBeNull();
    expect(warning?.message).toContain("data unavailable");
  });

  test("returns null for CACHE source without matching error patterns", () => {
    const result: FetchResult = {
      metrics: { session: { used_pct: 10, remaining_pct: 90, resets: "2h" } },
      source: DataSource.CACHE,
      timestamp: Date.now() / 1000,
      error: "Some unrelated error",
      stale: false,
    };
    expect(detectWarning("claude", result)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectLimitAdjustment
// ---------------------------------------------------------------------------

describe("detectLimitAdjustment", () => {
  // Helper to build MetricsDict with specific resets and usage
  function makeMetrics(sessionResets: string, sessionUsed: number): MetricsDict {
    return {
      subscription_type: "max",
      session: {
        used_pct: sessionUsed,
        remaining_pct: 100 - sessionUsed,
        resets: sessionResets,
      },
    };
  }

  test("returns empty array when no adjustment detected", () => {
    // Same reset time and usage
    const prev = makeMetrics("3:00pm", 50);
    const current = makeMetrics("3:00pm", 50);
    expect(detectLimitAdjustment("claude", prev, current)).toEqual([]);
  });

  test("returns warning when reset shifts forward >2h AND usage drops >=10 points", () => {
    // Reset shifts from 3:00pm to 6:00pm (3h shift) and usage drops from 60 to 40
    const prev = makeMetrics("3:00pm", 60);
    const current = makeMetrics("6:00pm", 40);
    const warnings = detectLimitAdjustment("claude", prev, current);
    expect(warnings.length).toBe(1);
    expect(warnings[0].service).toBe("claude");
    expect(warnings[0].message).toContain("limit adjusted");
    expect(warnings[0].action).toContain("60%");
    expect(warnings[0].action).toContain("40%");
  });

  test("does not trigger when only reset shifts (no usage drop)", () => {
    // Reset shifts forward 3h but usage stays the same
    const prev = makeMetrics("3:00pm", 50);
    const current = makeMetrics("6:00pm", 50);
    expect(detectLimitAdjustment("claude", prev, current)).toEqual([]);
  });

  test("does not trigger when only usage drops (no reset shift)", () => {
    // Usage drops 20 points but reset time is the same
    const prev = makeMetrics("3:00pm", 60);
    const current = makeMetrics("3:00pm", 40);
    expect(detectLimitAdjustment("claude", prev, current)).toEqual([]);
  });

  test("returns warnings for multiple metrics", () => {
    const prev: MetricsDict = {
      subscription_type: "max",
      session: { used_pct: 60, remaining_pct: 40, resets: "3:00pm" },
      week_all: { used_pct: 50, remaining_pct: 50, resets: "Feb 20 at 3:00pm" },
    };
    const current: MetricsDict = {
      subscription_type: "max",
      session: { used_pct: 40, remaining_pct: 60, resets: "6:00pm" },
      week_all: { used_pct: 30, remaining_pct: 70, resets: "Feb 20 at 6:00pm" },
    };
    const warnings = detectLimitAdjustment("claude", prev, current);
    expect(warnings.length).toBe(2);
  });
});
