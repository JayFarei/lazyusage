/**
 * Tests for Grok Build support: credentials, billing parsing, API provider, ledger parser.
 * All tests run against a temporary GROK_HOME so they never touch real credentials.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseGrokSessions } from "../../packages/core/src/parsers/grok-parser.js";
import { GrokAPIProvider, parseGrokBillingResponse } from "../../packages/core/src/providers/api-grok.js";
import { PersistentFallbackChain } from "../../packages/core/src/providers/chain.js";
import { GrokCredentialStore } from "../../packages/core/src/providers/credentials.js";
import { DataSource, type UsageProvider } from "../../packages/core/src/types.js";

const originalFetch = globalThis.fetch;
type GrokApiStatics = { _rateLimitedUntil: number; _lastSuccess: unknown };

let home: string;

function writeAuth(expiresAt: string, key = "grok-access-token"): void {
  writeFileSync(
    join(home, "auth.json"),
    JSON.stringify({
      "https://auth.x.ai::client-id": { key, auth_mode: "oidc", refresh_token: "refresh", expires_at: expiresAt },
    }),
  );
}

function writeSettingsCache(display: string): void {
  const payload = JSON.stringify({ settings: { subscription_tier: null, subscription_tier_display: display } });
  writeFileSync(join(home, "settings_cache.json"), JSON.stringify({ payload, signature: "sig" }));
}

const inOneHour = () => new Date(Date.now() + 3600_000).toISOString();

function billing(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    config: {
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        start: "2026-10-05T03:00:15.336969+00:00",
        end: "2026-10-12T03:00:15.336969+00:00",
      },
      creditUsagePercent: 10.0,
      productUsage: [{ product: "GrokBuild", usagePercent: 10.0 }],
      ...overrides,
    },
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lazyusage-grok-"));
  (GrokAPIProvider as unknown as GrokApiStatics)._rateLimitedUntil = 0;
  (GrokAPIProvider as unknown as GrokApiStatics)._lastSuccess = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(home, { recursive: true, force: true });
});

describe("GrokCredentialStore", () => {
  test("reads the OIDC access token and expiry from auth.json", () => {
    const expiresAt = inOneHour();
    writeAuth(expiresAt);
    const store = new GrokCredentialStore(home);
    expect(store.getCredentials()).toEqual({ accessToken: "grok-access-token", expiresAt: Date.parse(expiresAt) });
    expect(store.isAvailable()).toBe(true);
  });

  test("an expired token is unavailable but refreshable from disk", () => {
    writeAuth(new Date(Date.now() - 1000).toISOString());
    const store = new GrokCredentialStore(home);
    expect(store.isAvailable()).toBe(false);
    expect(store.canRefresh()).toBe(true);
  });

  test("tryRefreshToken picks up a token the grok CLI rewrote", async () => {
    writeAuth(new Date(Date.now() - 1000).toISOString(), "old");
    const store = new GrokCredentialStore(home);
    expect(store.isAvailable()).toBe(false);

    writeAuth(inOneHour(), "new");
    expect(await store.tryRefreshToken()).toBe(true);
    expect(store.getCredentials()?.accessToken).toBe("new");
  });

  test("missing auth.json means not available and not refreshable", () => {
    const store = new GrokCredentialStore(home);
    expect(store.getCredentials()).toBeNull();
    expect(store.isAvailable()).toBe(false);
    expect(store.canRefresh()).toBe(false);
  });

  test("prefers the session that expires last when auth.json has several", () => {
    writeFileSync(
      join(home, "auth.json"),
      JSON.stringify({
        "https://auth.x.ai::stale": { key: "stale-token", expires_at: new Date(Date.now() - 3600_000).toISOString() },
        "https://auth.x.ai::fresh": { key: "fresh-token", expires_at: inOneHour() },
      }),
    );
    expect(new GrokCredentialStore(home).getCredentials()?.accessToken).toBe("fresh-token");
  });

  test("reads the plan display name from the settings cache", () => {
    writeAuth(inOneHour());
    writeSettingsCache("X Premium");
    expect(new GrokCredentialStore(home).getSubscription()).toBe("X Premium");
  });
});

describe("parseGrokBillingResponse", () => {
  test("maps the weekly credit pool to the weekly metric", () => {
    const metrics = parseGrokBillingResponse(billing(), "X Premium");
    expect(metrics?.subscription_type).toBe("X Premium");
    expect(metrics?.weekly).toMatchObject({ used_pct: 10, remaining_pct: 90 });
    expect(typeof (metrics?.weekly as { resets: string }).resets).toBe("string");
  });

  test("treats an omitted usage percent as 0% (proto3 drops zero values)", () => {
    const body = billing();
    delete (body.config as Record<string, unknown>).creditUsagePercent;
    expect(parseGrokBillingResponse(body)?.weekly).toMatchObject({ used_pct: 0, remaining_pct: 100 });
  });

  test("clamps and rounds the percentage", () => {
    expect(parseGrokBillingResponse(billing({ creditUsagePercent: 42.6 }))?.weekly).toMatchObject({ used_pct: 43 });
    expect(parseGrokBillingResponse(billing({ creditUsagePercent: 130 }))?.weekly).toMatchObject({ used_pct: 100 });
  });

  test("rejects periods other than the weekly pool and malformed bodies", () => {
    const monthly = billing({ currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY", end: "2026-11-01T00:00:00Z" } });
    expect(parseGrokBillingResponse(monthly)).toBeNull();
    expect(parseGrokBillingResponse({})).toBeNull();
    expect(parseGrokBillingResponse({ config: { creditUsagePercent: 5 } })).toBeNull();
  });
});

describe("GrokAPIProvider", () => {
  test("fetches billing with the bearer token and parses it", async () => {
    writeAuth(inOneHour());
    writeSettingsCache("X Premium");
    let seenAuth = "";
    let seenUrl = "";
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify(billing({ creditUsagePercent: 37 })), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await new GrokAPIProvider(new GrokCredentialStore(home)).fetch();
    expect(result.error).toBeNull();
    expect(result.source).toBe(DataSource.API);
    expect(result.metrics?.weekly).toMatchObject({ used_pct: 37 });
    expect(result.metrics?.subscription_type).toBe("X Premium");
    expect(seenUrl).toBe(GrokAPIProvider.API_URL);
    expect(seenAuth).toBe("Bearer grok-access-token");
  });

  test("reuses the last result within the minimum polling interval", async () => {
    writeAuth(inOneHour());
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(billing()), { status: 200 });
    }) as unknown as typeof fetch;

    const provider = new GrokAPIProvider(new GrokCredentialStore(home));
    await provider.fetch();
    const second = await provider.fetch();
    expect(calls).toBe(1);
    expect(second.metrics?.weekly).toMatchObject({ used_pct: 10 });

    // --live and SSE build a new provider per poll; the throttle must still hold
    const third = await new GrokAPIProvider(new GrokCredentialStore(home)).fetch();
    expect(calls).toBe(1);
    expect(third.metrics?.weekly).toMatchObject({ used_pct: 10 });
  });

  test("a 429 sets the rate-limit window and skips the network until it passes", async () => {
    writeAuth(inOneHour());
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("slow down", {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "Retry-After": "30" },
      });
    }) as unknown as typeof fetch;

    const provider = new GrokAPIProvider(new GrokCredentialStore(home));
    const first = await provider.fetch();
    expect(first.error).toContain("429");
    expect(GrokAPIProvider.isRateLimited()).toBe(true);

    const second = await provider.fetch();
    expect(second.error).toContain("429");
    expect(calls).toBe(1);
  });

  test("surfaces auth failures as errors", async () => {
    writeAuth(inOneHour());
    globalThis.fetch = (async () =>
      new Response("unauthorized", { status: 401, statusText: "Unauthorized" })) as unknown as typeof fetch;
    const result = await new GrokAPIProvider(new GrokCredentialStore(home)).fetch();
    expect(result.metrics).toBeNull();
    expect(result.error).toContain("401");
  });

  test("an unrecognized body is an error, not zeros", async () => {
    writeAuth(inOneHour());
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ config: {} }), { status: 200 })) as unknown as typeof fetch;
    const result = await new GrokAPIProvider(new GrokCredentialStore(home)).fetch();
    expect(result.metrics).toBeNull();
    expect(result.error).toContain("Unrecognized");
  });
});

describe("PersistentFallbackChain without a PTY provider (grok)", () => {
  const service = `grok-test-${process.pid}`;
  afterEach(() => rmSync(join(homedir(), ".cache", "lazyusage", `${service}.json`), { force: true }));

  test("refresh reuses the last good result instead of redirecting into start()", async () => {
    let calls = 0;
    let ok = true;
    const provider: UsageProvider = {
      name: "MockGrok",
      sourceType: DataSource.API,
      isAvailable: () => true,
      fetch: async () => {
        calls++;
        return {
          metrics: ok
            ? { subscription_type: null, weekly: { used_pct: 12, remaining_pct: 88, resets: "Oct 12" } }
            : null,
          source: DataSource.API,
          timestamp: Date.now() / 1000,
          error: ok ? null : "API request failed: 503",
          stale: false,
        };
      },
    };

    const chain = new PersistentFallbackChain(service, [provider]);
    expect((await chain.start()).metrics?.weekly).toMatchObject({ used_pct: 12 });

    ok = false;
    const refreshed = await chain.refresh();
    expect(refreshed.stale).toBe(true);
    expect(refreshed.metrics?.weekly).toMatchObject({ used_pct: 12 });
    // One fetch for start, one for refresh; a redirect into start() would add a third
    expect(calls).toBe(2);
    await chain.stop();
  });
});

describe("parseGrokSessions", () => {
  function writeSession(cwd: string, id: string, turns: Array<Record<string, unknown>>): void {
    const dir = join(home, "sessions", encodeURIComponent(cwd), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "usage.json"), JSON.stringify({ sessionId: id, turns }));
  }

  const turn = (endedAt: string, input: number, cached: number, output: number) => ({
    endedAt,
    inputTokens: input,
    cachedReadTokens: cached,
    cacheCreationTokens: 0,
    outputTokens: output,
    totalTokens: input + output,
  });

  test("splits cache reads out of input and buckets turns by local end date", async () => {
    const day1 = new Date(2026, 9, 3, 23, 0).toISOString();
    const day2 = new Date(2026, 9, 4, 1, 0).toISOString();
    writeSession("/tmp/grok-project-a", "s1", [turn(day1, 1000, 800, 50), turn(day2, 500, 100, 20)]);

    const sessions = await parseGrokSessions(undefined, join(home, "sessions"));
    const byDate = Object.fromEntries(sessions.map((s) => [s.date, s]));

    expect(sessions).toHaveLength(2);
    expect(byDate["2026-10-03"]).toMatchObject({
      service: "grok",
      cwd: "/tmp/grok-project-a",
      inputTokens: 200,
      cacheReadTokens: 800,
      outputTokens: 50,
      totalTokens: 1050,
    });
    expect(byDate["2026-10-04"]).toMatchObject({ inputTokens: 400, cacheReadTokens: 100, totalTokens: 520 });
  });

  test("filters by since date and tolerates junk files", async () => {
    writeSession("/tmp/grok-project-b", "old", [turn(new Date(2026, 0, 1, 12).toISOString(), 10, 0, 1)]);
    writeSession("/tmp/grok-project-b", "new", [turn(new Date(2026, 9, 4, 12).toISOString(), 10, 0, 1)]);
    const junkDir = join(home, "sessions", "junk", "bad");
    mkdirSync(junkDir, { recursive: true });
    writeFileSync(join(junkDir, "usage.json"), "{not json");

    const sessions = await parseGrokSessions("2026-10-01", join(home, "sessions"));
    expect(sessions.map((s) => s.date)).toEqual(["2026-10-04"]);
  });

  test("returns nothing when the sessions directory does not exist", async () => {
    expect(await parseGrokSessions(undefined, join(home, "missing"))).toEqual([]);
  });
});
