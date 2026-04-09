/**
 * Unit tests for ClaudeWebProvider.
 * Uses constructor injection to mock cookie access.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ClaudeWebProvider, type CookieAccessor } from "../../packages/core/src/providers/web-claude.js";
import { DataSource } from "../../packages/core/src/types.js";

const originalFetch = globalThis.fetch;

function makeUsageResponse(overrides: Record<string, unknown> = {}) {
  return {
    five_hour: {
      utilization: 35,
      resets_at: new Date(Date.now() + 3600_000).toISOString(),
    },
    seven_day: {
      utilization: 18,
      resets_at: new Date(Date.now() + 86400_000 * 3).toISOString(),
    },
    seven_day_sonnet: {
      utilization: 8,
      resets_at: new Date(Date.now() + 86400_000 * 3).toISOString(),
    },
    ...overrides,
  };
}

function makeOrgsResponse() {
  return [{ uuid: "org-123", name: "Test Org", capabilities: ["chat"] }];
}

let mockCookieValue: string | null = "sk-ant-test-session-key";
let invalidateCalled = false;

function makeMockCookies(): CookieAccessor {
  return {
    get: () => mockCookieValue ? { value: mockCookieValue, source: "Firefox" } : null,
    invalidate: () => { invalidateCalled = true; mockCookieValue = null; },
  };
}

beforeEach(() => {
  (ClaudeWebProvider as any)._rateLimitedUntil = 0;
  mockCookieValue = "sk-ant-test-session-key";
  invalidateCalled = false;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ClaudeWebProvider - isAvailable", () => {
  test("returns false when no session cookie", () => {
    mockCookieValue = null;
    const provider = new ClaudeWebProvider(makeMockCookies());
    if (process.platform !== "darwin") return;
    expect(provider.isAvailable()).toBe(false);
  });

  test("returns false when rate-limited", () => {
    (ClaudeWebProvider as any)._rateLimitedUntil = Date.now() + 60_000;
    const provider = new ClaudeWebProvider(makeMockCookies());
    expect(provider.isAvailable()).toBe(false);
  });

  test("returns true when cookie available on darwin", () => {
    if (process.platform !== "darwin") return;
    const provider = new ClaudeWebProvider(makeMockCookies());
    expect(provider.isAvailable()).toBe(true);
  });
});

describe("ClaudeWebProvider - fetch", () => {
  test("returns error when no cookie available", async () => {
    mockCookieValue = null;
    const provider = new ClaudeWebProvider(makeMockCookies());
    const result = await provider.fetch();
    expect(result.error).toContain("No Claude session cookie");
    expect(result.metrics).toBeNull();
    expect(result.source).toBe(DataSource.WEB);
  });

  test("fetches org then usage and parses correctly", async () => {
    const provider = new ClaudeWebProvider(makeMockCookies());
    let callCount = 0;

    globalThis.fetch = (async (url: string) => {
      callCount++;
      if (url.includes("/organizations") && !url.includes("/usage")) {
        return new Response(JSON.stringify(makeOrgsResponse()), { status: 200 });
      }
      if (url.includes("/usage")) {
        return new Response(JSON.stringify(makeUsageResponse()), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await provider.fetch();

    expect(result.error).toBeNull();
    expect(result.source).toBe(DataSource.WEB);
    expect(result.metrics).not.toBeNull();
    expect(callCount).toBe(2);

    const session = result.metrics!.session as { used_pct: number; remaining_pct: number };
    expect(session.used_pct).toBe(35);
    expect(session.remaining_pct).toBe(65);

    const weekAll = result.metrics!.week_all as { used_pct: number };
    expect(weekAll.used_pct).toBe(18);

    const weekSonnet = result.metrics!.week_sonnet as { used_pct: number };
    expect(weekSonnet.used_pct).toBe(8);
  });

  test("caches org ID across fetches", async () => {
    const provider = new ClaudeWebProvider(makeMockCookies());
    let orgCallCount = 0;

    globalThis.fetch = (async (url: string) => {
      if (url.includes("/organizations") && !url.includes("/usage")) {
        orgCallCount++;
        return new Response(JSON.stringify(makeOrgsResponse()), { status: 200 });
      }
      return new Response(JSON.stringify(makeUsageResponse()), { status: 200 });
    }) as unknown as typeof fetch;

    await provider.fetch();
    await provider.fetch();

    expect(orgCallCount).toBe(1);
  });

  test("handles 401 by invalidating cookie cache", async () => {
    const provider = new ClaudeWebProvider(makeMockCookies());

    // First call succeeds to cache org ID
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/organizations") && !url.includes("/usage")) {
        return new Response(JSON.stringify(makeOrgsResponse()), { status: 200 });
      }
      return new Response(JSON.stringify(makeUsageResponse()), { status: 200 });
    }) as unknown as typeof fetch;
    await provider.fetch();

    // Second call returns 401
    globalThis.fetch = (async () =>
      new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch;

    const result = await provider.fetch();
    expect(result.error).toContain("unauthorized");
    expect(invalidateCalled).toBe(true);
  });

  test("handles 429 by setting rate limit timer", async () => {
    const provider = new ClaudeWebProvider(makeMockCookies());

    globalThis.fetch = (async (url: string) => {
      if (url.includes("/organizations") && !url.includes("/usage")) {
        return new Response(JSON.stringify(makeOrgsResponse()), { status: 200 });
      }
      return new Response("{}", { status: 429, headers: { "Retry-After": "45" } });
    }) as unknown as typeof fetch;

    const result = await provider.fetch();
    expect(result.error).toContain("rate limited");
    expect(ClaudeWebProvider.isRateLimited()).toBe(true);
  });

  test("returns error when org resolution fails", async () => {
    const provider = new ClaudeWebProvider(makeMockCookies());

    globalThis.fetch = (async () =>
      new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;

    const result = await provider.fetch();
    expect(result.error).toContain("Could not resolve Claude organization");
    expect(result.metrics).toBeNull();
  });

  test("handles empty orgs array", async () => {
    const provider = new ClaudeWebProvider(makeMockCookies());

    globalThis.fetch = (async () =>
      new Response(JSON.stringify([]), { status: 200 })) as unknown as typeof fetch;

    const result = await provider.fetch();
    expect(result.error).toContain("Could not resolve Claude organization");
  });

  test("handles missing utilization fields with zero defaults", async () => {
    const provider = new ClaudeWebProvider(makeMockCookies());

    globalThis.fetch = (async (url: string) => {
      if (url.includes("/organizations") && !url.includes("/usage")) {
        return new Response(JSON.stringify(makeOrgsResponse()), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await provider.fetch();
    expect(result.error).toBeNull();
    expect(result.metrics).not.toBeNull();
    const session = result.metrics!.session as { used_pct: number };
    expect(session.used_pct).toBe(0);
  });
});

describe("ClaudeWebProvider - rate limit", () => {
  test("isRateLimited returns false initially", () => {
    expect(ClaudeWebProvider.isRateLimited()).toBe(false);
  });

  test("isRateLimited returns true after being set", () => {
    (ClaudeWebProvider as any)._rateLimitedUntil = Date.now() + 60_000;
    expect(ClaudeWebProvider.isRateLimited()).toBe(true);
  });
});
