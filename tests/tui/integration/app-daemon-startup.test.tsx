import { describe, expect, mock, test } from "bun:test";
import { DataSource, type PersistentFallbackChain } from "@lazyusage/core";
import { App } from "../../../packages/cli/src/tui/App.js";
import {
  createMockGraphStore,
  mockClaudeMetrics,
  mockCodexMetrics,
  mockHistoryEntries,
  renderComponent,
} from "../helpers.js";

type AppChain = Pick<PersistentFallbackChain, "start" | "refresh" | "stop">;

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
            createClaudeChain: claudeChain.factory,
            createCodexChain: codexChain.factory,
            createLedgerData: () => ({
              claudeDaily: () => null,
              claudeWeekly: () => null,
              claudeMonthly: () => null,
              codexDaily: () => null,
              codexWeekly: () => null,
              codexMonthly: () => null,
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
              claudePrediction: () => null,
              codexPrediction: () => null,
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
            createClaudeChain: claudeChain.factory,
            createCodexChain: codexChain.factory,
            createLedgerData: () => ({
              claudeDaily: () => null,
              claudeWeekly: () => null,
              claudeMonthly: () => null,
              codexDaily: () => null,
              codexWeekly: () => null,
              codexMonthly: () => null,
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
              claudePrediction: () => null,
              codexPrediction: () => null,
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
          deps={{
            createDaemonDetection: () => ({
              daemonHealthy: () => true,
              daemonBackedServices: () => ({
                claude: true,
                codex: false,
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
            createClaudeChain: claudeChain.factory,
            createCodexChain: (persistent: boolean) => createCodexChain(persistent),
            createLedgerData: () => ({
              claudeDaily: () => null,
              claudeWeekly: () => null,
              claudeMonthly: () => null,
              codexDaily: () => null,
              codexWeekly: () => null,
              codexMonthly: () => null,
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
              claudePrediction: () => null,
              codexPrediction: () => null,
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
          deps={{
            createDaemonDetection: () => ({
              daemonHealthy: () => true,
              daemonBackedServices: () => ({
                claude: true,
                codex: false,
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
            createClaudeChain: (persistent: boolean) => createClaudeChain(persistent),
            createCodexChain: (persistent: boolean) => createCodexChain(persistent),
            createLedgerData: () => ({
              claudeDaily: () => null,
              claudeWeekly: () => null,
              claudeMonthly: () => null,
              codexDaily: () => null,
              codexWeekly: () => null,
              codexMonthly: () => null,
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
              claudePrediction: () => null,
              codexPrediction: () => null,
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
            createClaudeChain: (persistent: boolean) => createClaudeChain(persistent),
            createCodexChain: codexChain.factory,
            createLedgerData: () => ({
              claudeDaily: () => null,
              claudeWeekly: () => null,
              claudeMonthly: () => null,
              codexDaily: () => null,
              codexWeekly: () => null,
              codexMonthly: () => null,
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
              claudePrediction: () => null,
              codexPrediction: () => null,
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
