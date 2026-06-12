/**
 * Unit tests for ClaudeAPIProvider.
 * Mocks globalThis.fetch to test API interaction and response parsing.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAPIProvider } from "../../packages/core/src/providers/api-claude.js";
import { ClaudeCredentialStore } from "../../packages/core/src/providers/credentials.js";
import { DataSource } from "../../packages/core/src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let tempCredsPath: string;
type ClaudeApiProviderTestStatics = { _rateLimitedUntil: number };

function makeTempCredsPath(): string {
  return join(tmpdir(), `test-creds-claude-api-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function writeCredsFile(path: string): void {
  const creds = {
    claudeAiOauth: {
      accessToken: "sk-ant-oat01-TEST",
      refreshToken: "sk-ant-ort01-TEST",
      expiresAt: Date.now() + 3600_000, // expires 1h from now
      subscriptionType: "max",
      rateLimitTier: "default",
    },
  };
  writeFileSync(path, JSON.stringify(creds));
}

function setClaudeApiRateLimit(value: number): void {
  (ClaudeAPIProvider as unknown as ClaudeApiProviderTestStatics)._rateLimitedUntil = value;
}

function makeApiResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    five_hour: {
      utilization: 42,
      resets_at: new Date(Date.now() + 3600_000).toISOString(),
    },
    seven_day: {
      utilization: 25,
      resets_at: new Date(Date.now() + 86400_000 * 3).toISOString(),
    },
    seven_day_sonnet: {
      utilization: 10,
      resets_at: new Date(Date.now() + 86400_000 * 3).toISOString(),
    },
    ...overrides,
  };
}

beforeEach(() => {
  // Reset static rate limit state
  setClaudeApiRateLimit(0);
  tempCredsPath = makeTempCredsPath();
  process.env.CLAUDE_CREDENTIALS_FILE = tempCredsPath;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.CLAUDE_CREDENTIALS_FILE;
  try {
    rmSync(tempCredsPath, { force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudeAPIProvider - successful fetch + parse", () => {
  test("parses API response into correct MetricsDict", async () => {
    writeCredsFile(tempCredsPath);
    const credStore = new ClaudeCredentialStore();
    const provider = new ClaudeAPIProvider(credStore);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(makeApiResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await provider.fetch();

    expect(result.error).toBeNull();
    expect(result.source).toBe(DataSource.API);
    expect(result.metrics).not.toBeNull();

    const session = result.metrics?.session as { used_pct: number; remaining_pct: number };
    expect(session.used_pct).toBe(42);
    expect(session.remaining_pct).toBe(58);

    const weekAll = result.metrics?.week_all as { used_pct: number };
    expect(weekAll.used_pct).toBe(25);

    const weekSonnet = result.metrics?.week_sonnet as { used_pct: number };
    expect(weekSonnet.used_pct).toBe(10);

    expect(result.metrics?.subscription_type).toBe("max");
  });
});

describe("ClaudeAPIProvider - rate limit (429)", () => {
  test("returns error on 429 response and sets rate limit timer", async () => {
    writeCredsFile(tempCredsPath);
    const credStore = new ClaudeCredentialStore();
    const provider = new ClaudeAPIProvider(credStore);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "Rate limited", type: "rate_limit_error" } }), {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "120" },
      })) as unknown as typeof fetch;

    const result = await provider.fetch();

    expect(result.error).toContain("429");
    expect(result.metrics).toBeNull();

    // Second fetch should be short-circuited by the rate limit timer
    const result2 = await provider.fetch();
    expect(result2.error).toContain("429");
  });
});

describe("ClaudeAPIProvider - timeout", () => {
  test("returns error when fetch throws AbortError", async () => {
    writeCredsFile(tempCredsPath);
    const credStore = new ClaudeCredentialStore();
    const provider = new ClaudeAPIProvider(credStore);

    globalThis.fetch = (async () => {
      const err = new DOMException("The operation was aborted", "AbortError");
      throw err;
    }) as unknown as typeof fetch;

    const result = await provider.fetch();

    expect(result.error).toContain("aborted");
    expect(result.metrics).toBeNull();
  });
});

describe("ClaudeAPIProvider - malformed response", () => {
  test("handles missing fields with zero defaults", async () => {
    writeCredsFile(tempCredsPath);
    const credStore = new ClaudeCredentialStore();
    const provider = new ClaudeAPIProvider(credStore);

    // Response with missing fields
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await provider.fetch();

    expect(result.error).toBeNull();
    expect(result.metrics).not.toBeNull();
    const session = result.metrics?.session as { used_pct: number };
    expect(session.used_pct).toBe(0);
  });
});

describe("ClaudeAPIProvider - network error", () => {
  test("returns error when fetch throws", async () => {
    writeCredsFile(tempCredsPath);
    const credStore = new ClaudeCredentialStore();
    const provider = new ClaudeAPIProvider(credStore);

    globalThis.fetch = (async () => {
      throw new Error("Network connection failed");
    }) as unknown as typeof fetch;

    const result = await provider.fetch();

    expect(result.error).toContain("Network connection failed");
    expect(result.metrics).toBeNull();
  });
});

describe("ClaudeAPIProvider - no credentials", () => {
  test("returns error when credential store returns null", async () => {
    // Create a fake credential store that always returns null
    const fakeCredStore = {
      isAvailable: () => false,
      getCredentials: () => null,
      canRefresh: () => false,
      tryRefreshToken: async () => false,
    } as unknown as ClaudeCredentialStore;

    const provider = new ClaudeAPIProvider(fakeCredStore);
    const result = await provider.fetch();

    expect(result.error).toContain("No credentials available");
    expect(result.metrics).toBeNull();
  });
});
