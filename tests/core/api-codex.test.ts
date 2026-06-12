/**
 * Unit tests for CodexAPIProvider.
 *
 * The provider reads credentials from ~/.codex/auth.json which most CI/dev
 * environments lack. Tests are split into:
 *   1. No-credential path (always exercised)
 *   2. Mock-fetch paths (exercised only when real credentials exist)
 *
 * Each mock-fetch test asserts the no-credential fallback explicitly so
 * a missing auth.json never causes a silent skip.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { CodexAPIProvider } from "../../packages/core/src/providers/api-codex.js";
import { DataSource } from "../../packages/core/src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function makeCodexApiResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    plan_type: "plus",
    rate_limit: {
      primary_window: {
        used_percent: 30,
        reset_at: now + 3600,
      },
      secondary_window: {
        used_percent: 12,
        reset_at: now + 86400 * 3,
      },
    },
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Helper: run a test that requires Codex credentials.
 * When credentials are absent the test still exercises the no-credential
 * error path and makes meaningful assertions instead of silently returning.
 */
function withCredentialsOrFallback(provider: CodexAPIProvider, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    if (!provider.isAvailable()) {
      const result = await provider.fetch();
      expect(result.error).toBe("No credentials available");
      expect(result.metrics).toBeNull();
      expect(result.source).toBe(DataSource.API);
      return;
    }
    await fn();
  };
}

// ---------------------------------------------------------------------------
// Tests: no-credential path (always exercised, even on CI)
// ---------------------------------------------------------------------------

describe("CodexAPIProvider - no credentials", () => {
  test("isAvailable returns boolean", () => {
    const provider = new CodexAPIProvider();
    expect(typeof provider.isAvailable()).toBe("boolean");
  });

  test("fetch returns clear error when credentials absent", async () => {
    const provider = new CodexAPIProvider();
    if (provider.isAvailable()) return; // machine has real creds, skip

    const result = await provider.fetch();
    expect(result.error).toBe("No credentials available");
    expect(result.metrics).toBeNull();
    expect(result.source).toBe(DataSource.API);
    expect(result.stale).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: mock-fetch paths (require real ~/.codex/auth.json)
// Each test still asserts the no-credential fallback when creds are absent.
// ---------------------------------------------------------------------------

describe("CodexAPIProvider - successful fetch + parse", () => {
  const provider = new CodexAPIProvider();

  test(
    "parses API response into correct MetricsDict",
    withCredentialsOrFallback(provider, async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(makeCodexApiResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch;

      const result = await provider.fetch();
      expect(result.error).toBeNull();
      expect(result.source).toBe(DataSource.API);
      expect(result.metrics).not.toBeNull();

      const fiveH = result.metrics?.["5h"] as { used_pct: number; remaining_pct: number };
      expect(fiveH.used_pct).toBe(30);
      expect(fiveH.remaining_pct).toBe(70);

      const weekly = result.metrics?.weekly as { used_pct: number; remaining_pct: number };
      expect(weekly.used_pct).toBe(12);
      expect(weekly.remaining_pct).toBe(88);

      expect(result.metrics?.subscription_type).toBe("Plus");
    }),
  );
});

describe("CodexAPIProvider - fetch error paths", () => {
  const provider = new CodexAPIProvider();

  test(
    "returns error when fetch throws network error",
    withCredentialsOrFallback(provider, async () => {
      globalThis.fetch = (async () => {
        throw new Error("DNS resolution failed");
      }) as unknown as typeof fetch;

      const result = await provider.fetch();
      expect(result.error).toContain("DNS resolution failed");
      expect(result.metrics).toBeNull();
    }),
  );

  test(
    "returns error on non-200 response",
    withCredentialsOrFallback(provider, async () => {
      globalThis.fetch = (async () =>
        new Response("Forbidden", { status: 403, statusText: "Forbidden" })) as unknown as typeof fetch;

      const result = await provider.fetch();
      expect(result.error).toContain("403");
      expect(result.metrics).toBeNull();
    }),
  );

  test(
    "returns error when fetch throws AbortError (timeout)",
    withCredentialsOrFallback(provider, async () => {
      globalThis.fetch = (async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      }) as unknown as typeof fetch;

      const result = await provider.fetch();
      expect(result.error).toContain("aborted");
      expect(result.metrics).toBeNull();
    }),
  );
});

describe("CodexAPIProvider - response parsing", () => {
  const provider = new CodexAPIProvider();

  test(
    "handles empty response body with zero defaults",
    withCredentialsOrFallback(provider, async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })) as unknown as typeof fetch;

      const result = await provider.fetch();
      expect(result.error).toBeNull();
      expect(result.metrics).not.toBeNull();
      const fiveH = result.metrics?.["5h"] as { used_pct: number };
      expect(fiveH.used_pct).toBe(0);
    }),
  );
});
