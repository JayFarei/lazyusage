import { describe, expect, mock, test } from "bun:test";
import { DataSource, type PersistentFallbackChain, type ServiceName } from "lazyusage-core";
import { App } from "../../../packages/cli/src/tui/App.js";
import {
  createMockGraphStore,
  mockClaudeMetrics,
  mockCodexMetrics,
  mockHistoryEntries,
  renderComponent,
} from "../helpers.js";

type AppChain = Pick<PersistentFallbackChain, "start" | "refresh" | "stop">;
type ChainFactory = (persistent: boolean) => AppChain;

/** Route App's createChain(service, persistent) to per-service factories; unknown services fail loudly. */
function routeChains(factories: Partial<Record<ServiceName, ChainFactory>>) {
  return (service: ServiceName, persistent: boolean): AppChain => {
    const factory = factories[service];
    if (!factory) throw new Error(`Unexpected chain for ${service}`);
    return factory(persistent);
  };
}

function createThrowingChainFactory(message: string) {
  const spy = mock((_persistent: boolean): never => {
    throw new Error(message);
  });

  return {
    spy,
    factory: (persistent: boolean): never => spy(persistent),
  };
}

describe("App daemon startup", () => {
  test("cycles daemon-backed stats tabs through Graph and back to Daily", async () => {
    const history = mockHistoryEntries([
      { minutesAgo: 240, usedPct: 8 },
      { minutesAgo: 180, usedPct: 18 },
      { minutesAgo: 60, usedPct: 31 },
    ]);
    const claudeChain = createThrowingChainFactory("Claude chain should not be created when daemon-backed");
    const codexChain = createThrowingChainFactory("Codex chain should not be created in Claude-only mode");
    const { captureCharFrame, mockInput, renderOnce, renderer } = await renderComponent(
      () => (
        <App
          service="claude"
          deps={{
            createDaemonDetection: () => ({
              daemonHealthy: () => true,
              daemonBackedServices: () => ({
                claude: true,
                codex: false,
                grok: false,
              }),
              daemonMetrics: () => ({
                claude: mockClaudeMetrics(),
              }),
              detect: mock(() => {}),
            }),
            createUsageStore: () => ({
              cleanupOldSnapshots: mock(() => {}),
              storeSnapshot: mock(() => {}),
              close: mock(() => {}),
            }),
            createGraphStore: () =>
              createMockGraphStore({
                session: history,
                week_all: history,
                week_sonnet: history,
              }),
            createDedupTracker: () => ({
              shouldStoreMetrics: () => true,
            }),
            createChain: routeChains({ claude: claudeChain.factory, codex: codexChain.factory }),
            createLedgerData: () => ({
              ledgerFor: () => null,
              loading: () => false,
              error: () => null,
              refresh: mock(async () => {}),
              killAll: mock(() => {}),
            }),
            createAutoRefresh: () => ({
              enabled: () => true,
              interval: () => 10,
              togglePause: mock(() => {}),
              speedUp: mock(() => {}),
              slowDown: mock(() => {}),
              startTimer: mock(() => {}),
            }),
            createPrediction: () => ({
              predictionFor: () => null,
            }),
            setIntervalFn: (() => 0) as typeof setInterval,
            clearIntervalFn: (() => {}) as typeof clearInterval,
          }}
        />
      ),
      { width: 140, height: 40 },
    );

    await Bun.sleep(10);
    await renderOnce();

    mockInput.pressKey("3");
    mockInput.pressKey("]");
    mockInput.pressKey("]");
    mockInput.pressKey("]");
    await Bun.sleep(10);
    await renderOnce();

    expect(captureCharFrame()).toContain("\u2501 Graph \u2501");

    mockInput.pressKey("]");
    await Bun.sleep(10);
    await renderOnce();

    expect(captureCharFrame()).toContain("\u2501 Daily \u2501");

    renderer.destroy();
  });

  test("opens the fullscreen graph overlay for daemon-backed services", async () => {
    const history = mockHistoryEntries([
      { minutesAgo: 240, usedPct: 9 },
      { minutesAgo: 180, usedPct: 16 },
      { minutesAgo: 90, usedPct: 27 },
      { minutesAgo: 20, usedPct: 39 },
    ]);
    const claudeChain = createThrowingChainFactory("Claude chain should not be created when daemon-backed");
    const codexChain = createThrowingChainFactory("Codex chain should not be created in Claude-only mode");
    const { captureCharFrame, mockInput, renderOnce, renderer } = await renderComponent(
      () => (
        <App
          service="claude"
          deps={{
            createDaemonDetection: () => ({
              daemonHealthy: () => true,
              daemonBackedServices: () => ({
                claude: true,
                codex: false,
                grok: false,
              }),
              daemonMetrics: () => ({
                claude: mockClaudeMetrics(),
              }),
              detect: mock(() => {}),
            }),
            createUsageStore: () => ({
              cleanupOldSnapshots: mock(() => {}),
              storeSnapshot: mock(() => {}),
              close: mock(() => {}),
            }),
            createGraphStore: () =>
              createMockGraphStore({
                session: history,
                week_all: history,
                week_sonnet: history,
              }),
            createDedupTracker: () => ({
              shouldStoreMetrics: () => true,
            }),
            createChain: routeChains({ claude: claudeChain.factory, codex: codexChain.factory }),
            createLedgerData: () => ({
              ledgerFor: () => null,
              loading: () => false,
              error: () => null,
              refresh: mock(async () => {}),
              killAll: mock(() => {}),
            }),
            createAutoRefresh: () => ({
              enabled: () => true,
              interval: () => 10,
              togglePause: mock(() => {}),
              speedUp: mock(() => {}),
              slowDown: mock(() => {}),
              startTimer: mock(() => {}),
            }),
            createPrediction: () => ({
              predictionFor: () => null,
            }),
            setIntervalFn: (() => 0) as typeof setInterval,
            clearIntervalFn: (() => {}) as typeof clearInterval,
          }}
        />
      ),
      { width: 140, height: 40 },
    );

    await Bun.sleep(10);
    await renderOnce();

    mockInput.pressKey("3");
    mockInput.pressKey("]");
    mockInput.pressKey("]");
    mockInput.pressKey("]");
    await Bun.sleep(10);
    await renderOnce();

    mockInput.pressKey("g");
    await Bun.sleep(10);
    await renderOnce();

    const frame = captureCharFrame();

    expect(frame).toContain("Graph");
    expect(frame).toContain("Weekly (All)");
    expect(frame).toContain("Session (5h)");
    expect(frame).toContain("actual");

    renderer.destroy();
  });

  test("shows the Graph tab only for daemon-backed services", async () => {
    const claudeChain = createThrowingChainFactory("Claude chain should not be created when daemon-backed");
    const createCodexChain = mock(
      (_persistent: boolean): AppChain => ({
        start: mock(async () => ({
          metrics: mockCodexMetrics(),
          source: DataSource.API,
          timestamp: Date.now(),
          error: null,
          stale: false,
        })),
        refresh: mock(async () => ({
          metrics: mockCodexMetrics(),
          source: DataSource.API,
          timestamp: Date.now(),
          error: null,
          stale: false,
        })),
        stop: mock(async () => {}),
      }),
    );
    const { captureCharFrame, renderOnce, renderer } = await renderComponent(
      () => (
        <App
          services={["claude", "codex"]}
          deps={{
            createDaemonDetection: () => ({
              daemonHealthy: () => true,
              daemonBackedServices: () => ({
                claude: true,
                codex: false,
                grok: false,
              }),
              daemonMetrics: () => ({
                claude: mockClaudeMetrics(),
              }),
              detect: mock(() => {}),
            }),
            createUsageStore: () => ({
              cleanupOldSnapshots: mock(() => {}),
              storeSnapshot: mock(() => {}),
              close: mock(() => {}),
            }),
            createDedupTracker: () => ({
              shouldStoreMetrics: () => true,
            }),
            createChain: routeChains({
              claude: claudeChain.factory,
              codex: (persistent: boolean) => createCodexChain(persistent),
            }),
            createLedgerData: () => ({
              ledgerFor: () => null,
              loading: () => false,
              error: () => null,
              refresh: mock(async () => {}),
              killAll: mock(() => {}),
            }),
            createAutoRefresh: () => ({
              enabled: () => true,
              interval: () => 10,
              togglePause: mock(() => {}),
              speedUp: mock(() => {}),
              slowDown: mock(() => {}),
              startTimer: mock(() => {}),
            }),
            createPrediction: () => ({
              predictionFor: () => null,
            }),
            setIntervalFn: (() => 0) as typeof setInterval,
            clearIntervalFn: (() => {}) as typeof clearInterval,
          }}
        />
      ),
      { width: 140, height: 40 },
    );

    await Bun.sleep(10);
    await renderOnce();

    const graphMatches = captureCharFrame().match(/Graph/g) ?? [];
    expect(graphMatches).toHaveLength(1);

    renderer.destroy();
  });

  test("hydrates daemon-backed services and skips local chain startup for them", async () => {
    const claudeDaemonMetrics = mockClaudeMetrics({
      sessionPct: 12,
      weekAllPct: 23,
      weekSonnetPct: 34,
      subscriptionType: "max",
    });
    const codexLiveMetrics = mockCodexMetrics({
      fiveHourPct: 45,
      weeklyPct: 67,
      subscriptionType: "plus",
    });

    const detect = mock(() => {});
    const createClaudeChain = mock(() => {
      throw new Error("Claude chain should not be created when daemon-backed");
    });
    const codexStart = mock(async () => ({
      metrics: codexLiveMetrics,
      source: DataSource.API,
      timestamp: Date.now(),
      error: null,
      stale: false,
    }));
    const createCodexChain = mock(() => ({
      start: codexStart,
      refresh: mock(async () => ({
        metrics: codexLiveMetrics,
        source: DataSource.API,
        timestamp: Date.now(),
        error: null,
        stale: false,
      })),
      stop: mock(async () => {}),
    }));

    const ledgerRefresh = mock(async () => {});
    const startTimer = mock(() => {});

    const { captureCharFrame, renderOnce, renderer } = await renderComponent(
      () => (
        <App
          services={["claude", "codex"]}
          deps={{
            createDaemonDetection: () => ({
              daemonHealthy: () => true,
              daemonBackedServices: () => ({
                claude: true,
                codex: false,
                grok: false,
              }),
              daemonMetrics: () => ({
                claude: claudeDaemonMetrics,
              }),
              detect,
            }),
            createUsageStore: () => ({
              cleanupOldSnapshots: mock(() => {}),
              storeSnapshot: mock(() => {}),
              close: mock(() => {}),
            }),
            createDedupTracker: () => ({
              shouldStoreMetrics: () => true,
            }),
            createChain: routeChains({
              claude: (persistent: boolean) => createClaudeChain(persistent),
              codex: (persistent: boolean) => createCodexChain(persistent),
            }),
            createLedgerData: () => ({
              ledgerFor: () => null,
              loading: () => false,
              error: () => null,
              refresh: ledgerRefresh,
              killAll: mock(() => {}),
            }),
            createAutoRefresh: () => ({
              enabled: () => true,
              interval: () => 10,
              togglePause: mock(() => {}),
              speedUp: mock(() => {}),
              slowDown: mock(() => {}),
              startTimer,
            }),
            createPrediction: () => ({
              predictionFor: () => null,
            }),
            setIntervalFn: (() => 0) as typeof setInterval,
            clearIntervalFn: (() => {}) as typeof clearInterval,
          }}
        />
      ),
      { width: 140, height: 40 },
    );

    await Bun.sleep(10);
    await renderOnce();

    const frame = captureCharFrame();

    expect(detect).toHaveBeenCalledTimes(1);
    expect(createClaudeChain).not.toHaveBeenCalled();
    expect(createCodexChain).toHaveBeenCalledTimes(1);
    expect(codexStart).toHaveBeenCalledTimes(1);
    expect(startTimer).toHaveBeenCalledTimes(1);
    expect(ledgerRefresh).toHaveBeenCalledWith(true);
    expect(frame).toContain("Source: Claude: daemon | Codex: API");
    expect(frame).toContain("Weekly (All)");
    expect(frame).toContain("◆ 23%");
    expect(frame).toContain("Weekly");
    expect(frame).toContain("◆ 67%");

    renderer.destroy();
  });

  test("pressing r performs a one-shot fetch for a daemon-backed service", async () => {
    const daemonMetrics = mockClaudeMetrics({
      sessionPct: 12,
      weekAllPct: 23,
      weekSonnetPct: 34,
      subscriptionType: "max",
    });
    const refreshedMetrics = mockClaudeMetrics({
      sessionPct: 78,
      weekAllPct: 88,
      weekSonnetPct: 91,
      subscriptionType: "max",
    });

    const temporaryChainStart = mock(async () => ({
      metrics: refreshedMetrics,
      source: DataSource.API,
      timestamp: Date.now(),
      error: null,
      stale: false,
    }));
    const temporaryChainStop = mock(async () => {});
    const createClaudeChain = mock(() => ({
      start: temporaryChainStart,
      refresh: mock(async () => {
        throw new Error("one-shot daemon refresh should use a fresh chain start");
      }),
      stop: temporaryChainStop,
    }));
    const codexChain = createThrowingChainFactory("Codex chain should not be created in Claude-only mode");

    const { captureCharFrame, mockInput, renderOnce, renderer } = await renderComponent(
      () => (
        <App
          service="claude"
          deps={{
            createDaemonDetection: () => ({
              daemonHealthy: () => true,
              daemonBackedServices: () => ({
                claude: true,
                codex: false,
                grok: false,
              }),
              daemonMetrics: () => ({
                claude: daemonMetrics,
              }),
              detect: mock(() => {}),
            }),
            createUsageStore: () => ({
              cleanupOldSnapshots: mock(() => {}),
              storeSnapshot: mock(() => {}),
              close: mock(() => {}),
            }),
            createDedupTracker: () => ({
              shouldStoreMetrics: () => true,
            }),
            createChain: routeChains({
              claude: (persistent: boolean) => createClaudeChain(persistent),
              codex: codexChain.factory,
            }),
            createLedgerData: () => ({
              ledgerFor: () => null,
              loading: () => false,
              error: () => null,
              refresh: mock(async () => {}),
              killAll: mock(() => {}),
            }),
            createAutoRefresh: () => ({
              enabled: () => true,
              interval: () => 10,
              togglePause: mock(() => {}),
              speedUp: mock(() => {}),
              slowDown: mock(() => {}),
              startTimer: mock(() => {}),
            }),
            createPrediction: () => ({
              predictionFor: () => null,
            }),
            setIntervalFn: (() => 0) as typeof setInterval,
            clearIntervalFn: (() => {}) as typeof clearInterval,
          }}
        />
      ),
      { width: 140, height: 40 },
    );

    await Bun.sleep(10);
    await renderOnce();

    expect(createClaudeChain).not.toHaveBeenCalled();
    expect(captureCharFrame()).toContain("Source: Claude: daemon");
    expect(captureCharFrame()).toContain("◆ 23%");

    mockInput.pressKey("r");
    await Bun.sleep(10);
    await renderOnce();

    expect(createClaudeChain).toHaveBeenCalledTimes(1);
    expect(temporaryChainStart).toHaveBeenCalledTimes(1);
    expect(temporaryChainStop).toHaveBeenCalledTimes(1);
    expect(captureCharFrame()).toContain("Source: Claude: API");
    expect(captureCharFrame()).toContain("◆ 88%");

    renderer.destroy();
  });
});

describe("App grok row", () => {
  test("renders a Grok Build row with its weekly bar when grok is visible", async () => {
    const grokMetrics = {
      subscription_type: "X Premium",
      weekly: { used_pct: 42, remaining_pct: 58, resets: "Oct 12 at 4:00am" },
    };
    const liveChain = (metrics: Record<string, unknown>): AppChain => ({
      start: mock(async () => ({ metrics, source: DataSource.API, timestamp: Date.now(), error: null, stale: false })),
      refresh: mock(async () => ({
        metrics,
        source: DataSource.API,
        timestamp: Date.now(),
        error: null,
        stale: false,
      })),
      stop: mock(async () => {}),
    });

    const { captureCharFrame, renderOnce, renderer } = await renderComponent(
      () => (
        <App
          services={["claude", "grok"]}
          deps={{
            createDaemonDetection: () => ({
              daemonHealthy: () => false,
              daemonBackedServices: () => ({ claude: false, codex: false, grok: false }),
              daemonMetrics: () => ({}),
              detect: mock(() => {}),
            }),
            createUsageStore: () => ({
              cleanupOldSnapshots: mock(() => {}),
              storeSnapshot: mock(() => {}),
              close: mock(() => {}),
            }),
            createDedupTracker: () => ({ shouldStoreMetrics: () => true }),
            createChain: routeChains({
              claude: () => liveChain(mockClaudeMetrics()),
              grok: () => liveChain(grokMetrics),
            }),
            createLedgerData: () => ({
              ledgerFor: () => null,
              loading: () => false,
              error: () => null,
              refresh: mock(async () => {}),
              killAll: mock(() => {}),
            }),
            createAutoRefresh: () => ({
              enabled: () => true,
              interval: () => 10,
              togglePause: mock(() => {}),
              speedUp: mock(() => {}),
              slowDown: mock(() => {}),
              startTimer: mock(() => {}),
            }),
            createPrediction: () => ({ predictionFor: () => null }),
            setIntervalFn: (() => 0) as typeof setInterval,
            clearIntervalFn: (() => {}) as typeof clearInterval,
          }}
        />
      ),
      { width: 140, height: 40 },
    );

    await Bun.sleep(10);
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).toContain("[5] Grok Build - X Premium");
    expect(frame).toContain("◆ 42%");
    expect(frame).toContain("[5]Grok");
    expect(frame).toContain("[6]GrokStats");
    expect(frame).not.toContain("Codex CLI");
    expect(frame).toContain("Grok token stats not available");

    renderer.destroy();
  });
});
