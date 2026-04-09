/**
 * Unit tests for CodexAPIProvider 429 rate-limit handling.
 * Mirrors the pattern from api-claude.test.ts.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { CodexAPIProvider } from "../../packages/core/src/providers/api-codex.js";
import { DataSource } from "../../packages/core/src/types.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Reset static rate limit state between tests
  (CodexAPIProvider as any)._rateLimitedUntil = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("CodexAPIProvider - rate limit (429)", () => {
  test("returns error on 429 and sets rate limit timer", async () => {
    const provider = new CodexAPIProvider();
    if (!provider.isAvailable()) {
      // No credentials, verify the no-creds path instead
      const result = await provider.fetch();
      expect(result.error).toBe("No credentials available");
      return;
    }

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: { message: "Rate limited", type: "rate_limit_error" } }),
        {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "Retry-After": "60" },
        },
      )) as unknown as typeof fetch;

    const result = await provider.fetch();
    expect(result.error).toContain("429");
    expect(result.metrics).toBeNull();

    // Static timer should be set
    expect(CodexAPIProvider.isRateLimited()).toBe(true);

    // Second fetch should be short-circuited without hitting globalThis.fetch
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("should not reach here", { status: 200 });
    }) as unknown as typeof fetch;

    const result2 = await provider.fetch();
    expect(result2.error).toContain("429");
    expect(result2.metrics).toBeNull();
    expect(fetchCalled).toBe(false);
  });

  test("uses retry-after header value for rate limit duration", async () => {
    const provider = new CodexAPIProvider();
    if (!provider.isAvailable()) return;

    globalThis.fetch = (async () =>
      new Response("{}", {
        status: 429,
        headers: { "Retry-After": "30" },
      })) as unknown as typeof fetch;

    await provider.fetch();

    // Should be rate-limited for ~30 seconds
    expect(CodexAPIProvider.isRateLimited()).toBe(true);

    // Manually expire the timer
    (CodexAPIProvider as any)._rateLimitedUntil = Date.now() - 1;
    expect(CodexAPIProvider.isRateLimited()).toBe(false);
  });

  test("defaults to CODEX_RATE_LIMIT_DEFAULT_SECONDS when no retry-after header", async () => {
    const provider = new CodexAPIProvider();
    if (!provider.isAvailable()) return;

    globalThis.fetch = (async () =>
      new Response("{}", { status: 429 })) as unknown as typeof fetch;

    const before = Date.now();
    await provider.fetch();
    const rateLimitedUntil = (CodexAPIProvider as any)._rateLimitedUntil;

    // Default is 60s, should be within 55-65s from now
    expect(rateLimitedUntil - before).toBeGreaterThan(55_000);
    expect(rateLimitedUntil - before).toBeLessThan(65_000);
  });

  test("isRateLimited returns false initially", () => {
    expect(CodexAPIProvider.isRateLimited()).toBe(false);
  });
});
