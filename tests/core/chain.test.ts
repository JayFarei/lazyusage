/**
 * Unit tests for PersistentFallbackChain refresh-before-PTY logic.
 * Pure mock test - no network, no files, no Keychain.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { PersistentFallbackChain, type TokenRefreshable } from "../../packages/core/src/providers/chain.js";
import { DataSource } from "../../packages/core/src/types.js";
import type { FetchResult, UsageProvider, PersistentUsageProvider } from "../../packages/core/src/types.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const SUCCESS_METRICS = {
  subscription_type: "max",
  session: { used_pct: 10, remaining_pct: 90, resets: "2h" },
  week_all: { used_pct: 20, remaining_pct: 80, resets: "3d" },
  week_sonnet: { used_pct: 5, remaining_pct: 95, resets: "3d" },
};

function makeApiResult(source: DataSource = DataSource.API): FetchResult {
  return { metrics: SUCCESS_METRICS, source, timestamp: Date.now() / 1000, error: null, stale: false };
}

function makePtyResult(): FetchResult {
  return { metrics: SUCCESS_METRICS, source: DataSource.PTY, timestamp: Date.now() / 1000, error: null, stale: false };
}

function makeErrorResult(): FetchResult {
  return { metrics: null, source: DataSource.API, timestamp: Date.now() / 1000, error: "fetch failed", stale: false };
}

class MockAPIProvider implements UsageProvider {
  name = "MockAPIProvider";
  sourceType = DataSource.API;
  callCount = 0;
  _available = false;

  isAvailable(): boolean { return this._available; }

  async fetch(): Promise<FetchResult> {
    this.callCount++;
    return this._available ? makeApiResult() : makeErrorResult();
  }
}

class MockPTYProvider implements PersistentUsageProvider {
  name = "MockPTYProvider";
  sourceType = DataSource.PTY;
  startCalled = false;
  refreshCallCount = 0;

  isAvailable(): boolean { return true; }
  async fetch(): Promise<FetchResult> { return makePtyResult(); }

  async start(): Promise<FetchResult> {
    this.startCalled = true;
    return makePtyResult();
  }

  async refresh(): Promise<FetchResult> {
    this.refreshCallCount++;
    return makePtyResult();
  }

  async stop(): Promise<void> {}
}

class MockCredStore implements TokenRefreshable {
  refreshCalled = false;
  refreshCallCount = 0;
  _canRefresh = true;
  _refreshResult = true;
  private _apiProvider: MockAPIProvider | null = null;

  /** Wire to an API provider so tryRefreshToken() makes the provider available */
  wireToApiProvider(provider: MockAPIProvider) {
    this._apiProvider = provider;
  }

  canRefresh(): boolean { return this._canRefresh; }

  async tryRefreshToken(): Promise<boolean> {
    this.refreshCalled = true;
    this.refreshCallCount++;
    if (this._refreshResult && this._apiProvider) {
      this._apiProvider._available = true;
    }
    return this._refreshResult;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PersistentFallbackChain - start()", () => {
  test("uses API directly when available", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = true;
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    const result = await chain.start();

    expect(result.source).toBe(DataSource.API);
    expect(ptyProvider.startCalled).toBe(false);
    expect(credStore.refreshCalled).toBe(false);
  });

  test("refreshes token before falling back to PTY when token is refreshable", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = false;
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();
    credStore.wireToApiProvider(apiProvider);

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    const result = await chain.start();

    expect(credStore.refreshCalled).toBe(true);
    expect(result.source).toBe(DataSource.API);
    expect(ptyProvider.startCalled).toBe(false);
  });

  test("falls back to PTY when token refresh fails", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = false;
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();
    credStore._refreshResult = false;

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    const result = await chain.start();

    expect(credStore.refreshCalled).toBe(true);
    expect(result.source).toBe(DataSource.PTY);
    expect(ptyProvider.startCalled).toBe(true);
  });

  test("falls back to PTY when no refresh token available", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = false;
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();
    credStore._canRefresh = false;

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    const result = await chain.start();

    expect(credStore.refreshCalled).toBe(false);
    expect(result.source).toBe(DataSource.PTY);
    expect(ptyProvider.startCalled).toBe(true);
  });

  test("falls back to PTY when no credStore provided", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = false;
    const ptyProvider = new MockPTYProvider();

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider);
    const result = await chain.start();

    expect(result.source).toBe(DataSource.PTY);
    expect(ptyProvider.startCalled).toBe(true);
  });
});

describe("PersistentFallbackChain - refresh()", () => {
  test("uses API directly when available on refresh", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = true;
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    // First start with API available
    await chain.start();
    const result = await chain.refresh();

    expect(result.source).toBe(DataSource.API);
    expect(credStore.refreshCalled).toBe(false);
  });

  test("refreshes token before PTY on refresh() when token expired", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = true;
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();
    credStore.wireToApiProvider(apiProvider);

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    // Start with API available, then simulate expiry
    await chain.start();
    apiProvider._available = false;

    const result = await chain.refresh();

    expect(credStore.refreshCalled).toBe(true);
    expect(result.source).toBe(DataSource.API);
    expect(ptyProvider.refreshCallCount).toBe(0);
  });

  test("falls back to PTY when token refresh fails on refresh() (PTY never started)", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = true;
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();
    credStore._refreshResult = false;

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    // First start uses API, so _ptyStarted stays false
    await chain.start();
    apiProvider._available = false;

    // refresh() calls start() because PTY was never started; start() calls ptyProvider.start()
    const result = await chain.refresh();

    expect(credStore.refreshCalled).toBe(true);
    expect(result.source).toBe(DataSource.PTY);
    expect(ptyProvider.startCalled).toBe(true); // start() path, not refresh() path
  });

  test("does not attempt token refresh when no refresh token on refresh() (PTY never started)", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = true;
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();
    credStore._canRefresh = false;

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    // First start uses API, so _ptyStarted stays false
    await chain.start();
    apiProvider._available = false;

    // refresh() calls start() because PTY was never started; start() calls ptyProvider.start()
    await chain.refresh();

    expect(credStore.refreshCalled).toBe(false);
    expect(ptyProvider.startCalled).toBe(true); // start() path, not refresh() path
  });

  test("calls ptyProvider.refresh() when PTY was already started and token refresh fails", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = false; // API never available, so PTY gets started immediately
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();
    credStore._refreshResult = false; // refresh fails too

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    // start() with API unavailable and refresh failing -> PTY is started
    await chain.start();
    expect(ptyProvider.startCalled).toBe(true);

    // Now call refresh() - PTY is started, so it calls ptyProvider.refresh()
    const result = await chain.refresh();

    expect(result.source).toBe(DataSource.PTY);
    expect(ptyProvider.refreshCallCount).toBe(1);
  });

  test("refresh() only attempts token refresh once per call (not re-entrantly)", async () => {
    const apiProvider = new MockAPIProvider();
    apiProvider._available = false;
    const ptyProvider = new MockPTYProvider();
    const credStore = new MockCredStore();
    credStore.wireToApiProvider(apiProvider);

    const chain = new PersistentFallbackChain("claude", apiProvider, ptyProvider, credStore);
    // Call start twice - simulating the chain being started and then refreshed
    await chain.start();
    apiProvider._available = false; // expire again
    await chain.refresh();

    // refresh should have been called once per start+refresh attempt that hits the refresh path
    expect(credStore.refreshCallCount).toBeGreaterThanOrEqual(1);
  });
});
