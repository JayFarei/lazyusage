/**
 * Unit tests for PersistentFallbackChain multi-provider array constructor.
 * Tests the new N-provider chain with immediate + persistent partitioning.
 */
import { describe, test, expect } from "bun:test";
import { PersistentFallbackChain, type TokenRefreshable } from "../../packages/core/src/providers/chain.js";
import { DataSource } from "../../packages/core/src/types.js";
import type { FetchResult, UsageProvider, PersistentUsageProvider } from "../../packages/core/src/types.js";

const SUCCESS_METRICS = {
  subscription_type: "max",
  session: { used_pct: 10, remaining_pct: 90, resets: "2h" },
  week_all: { used_pct: 20, remaining_pct: 80, resets: "3d" },
  week_sonnet: { used_pct: 5, remaining_pct: 95, resets: "3d" },
};

function makeResult(source: DataSource, success: boolean): FetchResult {
  return {
    metrics: success ? SUCCESS_METRICS : null,
    source,
    timestamp: Date.now() / 1000,
    error: success ? null : "fetch failed",
    stale: false,
  };
}

class MockProvider implements UsageProvider {
  name: string;
  sourceType: DataSource;
  fetchCallCount = 0;
  _shouldSucceed: boolean;

  constructor(name: string, source: DataSource, shouldSucceed: boolean) {
    this.name = name;
    this.sourceType = source;
    this._shouldSucceed = shouldSucceed;
  }

  isAvailable(): boolean { return true; }
  async fetch(): Promise<FetchResult> {
    this.fetchCallCount++;
    return makeResult(this.sourceType, this._shouldSucceed);
  }
}

class MockPersistentProvider implements PersistentUsageProvider {
  name = "MockPTY";
  sourceType = DataSource.PTY;
  startCallCount = 0;
  refreshCallCount = 0;
  stopCallCount = 0;

  isAvailable(): boolean { return true; }
  async fetch(): Promise<FetchResult> { return makeResult(DataSource.PTY, true); }

  async start(): Promise<FetchResult> {
    this.startCallCount++;
    return makeResult(DataSource.PTY, true);
  }
  async refresh(): Promise<FetchResult> {
    this.refreshCallCount++;
    return makeResult(DataSource.PTY, true);
  }
  async stop(): Promise<void> { this.stopCallCount++; }
}

class MockCredStore implements TokenRefreshable {
  refreshCallCount = 0;
  canRefresh(): boolean { return false; }
  async tryRefreshToken(): Promise<boolean> { this.refreshCallCount++; return false; }
}

describe("PersistentFallbackChain - array constructor", () => {
  test("uses first successful immediate provider", async () => {
    const api = new MockProvider("API", DataSource.API, true);
    const web = new MockProvider("Web", DataSource.WEB, true);
    const pty = new MockPersistentProvider();

    const chain = new PersistentFallbackChain("claude", [api, web, pty]);
    const result = await chain.start();

    expect(result.source).toBe(DataSource.API);
    expect(api.fetchCallCount).toBe(1);
    expect(web.fetchCallCount).toBe(0); // not tried, API succeeded
    expect(pty.startCallCount).toBe(0);
  });

  test("falls through to second immediate provider when first fails", async () => {
    const api = new MockProvider("API", DataSource.API, false);
    const web = new MockProvider("Web", DataSource.WEB, true);
    const pty = new MockPersistentProvider();

    const chain = new PersistentFallbackChain("claude", [api, web, pty]);
    const result = await chain.start();

    expect(result.source).toBe(DataSource.WEB);
    expect(api.fetchCallCount).toBe(1);
    expect(web.fetchCallCount).toBe(1);
    expect(pty.startCallCount).toBe(0);
  });

  test("falls through to persistent provider when all immediate providers fail", async () => {
    const api = new MockProvider("API", DataSource.API, false);
    const web = new MockProvider("Web", DataSource.WEB, false);
    const pty = new MockPersistentProvider();

    const chain = new PersistentFallbackChain("claude", [api, web, pty]);
    const result = await chain.start();

    expect(result.source).toBe(DataSource.PTY);
    expect(pty.startCallCount).toBe(1);
  });

  test("refresh uses immediate providers before persistent", async () => {
    const api = new MockProvider("API", DataSource.API, false);
    const web = new MockProvider("Web", DataSource.WEB, false);
    const pty = new MockPersistentProvider();

    const chain = new PersistentFallbackChain("claude", [api, web, pty]);
    // Start falls to PTY
    await chain.start();

    // Now API becomes available for refresh
    api._shouldSucceed = true;
    const result = await chain.refresh();

    expect(result.source).toBe(DataSource.API);
  });

  test("refresh calls persistent.refresh when PTY already started", async () => {
    const api = new MockProvider("API", DataSource.API, false);
    const pty = new MockPersistentProvider();

    const chain = new PersistentFallbackChain("claude", [api, pty]);
    await chain.start(); // starts PTY

    const result = await chain.refresh();

    expect(result.source).toBe(DataSource.PTY);
    expect(pty.refreshCallCount).toBe(1);
  });

  test("stop calls stop on all persistent providers", async () => {
    const api = new MockProvider("API", DataSource.API, false);
    const pty = new MockPersistentProvider();

    const chain = new PersistentFallbackChain("claude", [api, pty]);
    await chain.start(); // starts PTY

    await chain.stop();
    expect(pty.stopCallCount).toBe(1);
  });

  test("accepts credStore as second argument with array constructor", async () => {
    const api = new MockProvider("API", DataSource.API, true);
    const pty = new MockPersistentProvider();
    const credStore = new MockCredStore();

    const chain = new PersistentFallbackChain("claude", [api, pty], credStore);
    const result = await chain.start();

    expect(result.source).toBe(DataSource.API);
    // credStore not needed since API succeeded
    expect(credStore.refreshCallCount).toBe(0);
  });

  test("refresh preserves original source label when all live providers fail", async () => {
    // Scenario: API succeeds on first call, then all providers fail on refresh.
    // Should show stale API result, NOT "Cached".
    const api = new MockProvider("API", DataSource.API, true);

    // PTY that always fails
    const failPty: PersistentUsageProvider = {
      name: "FailPTY",
      sourceType: DataSource.PTY,
      isAvailable: () => true,
      fetch: async () => makeResult(DataSource.PTY, false),
      start: async () => makeResult(DataSource.PTY, false),
      refresh: async () => makeResult(DataSource.PTY, false),
      stop: async () => {},
    };

    const chain = new PersistentFallbackChain("claude", [api, failPty]);
    const firstResult = await chain.start();
    expect(firstResult.source).toBe(DataSource.API);

    // Now API also fails
    api._shouldSucceed = false;

    const refreshResult = await chain.refresh();

    // Should get the last good API result back, marked stale, NOT "cache"
    expect(refreshResult.source).toBe(DataSource.API);
    expect(refreshResult.stale).toBe(true);
    expect(refreshResult.metrics).not.toBeNull();
  });
});
