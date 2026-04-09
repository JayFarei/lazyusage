import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDaemonCollector } from "../../../packages/core/src/daemon/collector.js";
import { UsageStore } from "../../../packages/core/src/storage/database.js";
import { DataSource, type FetchResult, type MetricsDict } from "../../../packages/core/src/types.js";

const CLAUDE_METRICS: MetricsDict = {
  subscription_type: "max",
  session: { used_pct: 25, remaining_pct: 75, resets: "2h" },
  week_all: { used_pct: 40, remaining_pct: 60, resets: "3d" },
  week_sonnet: { used_pct: 15, remaining_pct: 85, resets: "3d" },
};

const CODEX_METRICS: MetricsDict = {
  subscription_type: "pro",
  "5h": { used_pct: 30, remaining_pct: 70, resets: "4h" },
  weekly: { used_pct: 55, remaining_pct: 45, resets: "3d" },
};

function makeSuccessResult(
  metrics: MetricsDict,
  source: DataSource,
): FetchResult {
  return {
    metrics,
    source,
    timestamp: Date.now() / 1000,
    error: null,
    stale: false,
  };
}

class MockChain {
  constructor(private readonly result: FetchResult | Error) {}

  refreshCalls = 0;

  async refresh(): Promise<FetchResult> {
    this.refreshCalls += 1;
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

describe("createDaemonCollector", () => {
  let store: UsageStore;

  beforeEach(() => {
    store = new UsageStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  test("runs one collection cycle and persists successful refresh results", async () => {
    const claudeChain = new MockChain(
      makeSuccessResult(CLAUDE_METRICS, DataSource.API),
    );
    const codexChain = new MockChain(
      makeSuccessResult(CODEX_METRICS, DataSource.PTY),
    );
    const warnings: string[] = [];

    const collector = createDaemonCollector({
      services: {
        claude: claudeChain,
        codex: codexChain,
      },
      store,
      logger: {
        warn: (message) => warnings.push(message),
      },
      now: () => new Date("2026-04-09T12:00:00.000Z"),
    });

    await collector.collectOnce();

    expect(claudeChain.refreshCalls).toBe(1);
    expect(codexChain.refreshCalls).toBe(1);
    expect(store.getLatestSnapshot("claude")).toEqual(CLAUDE_METRICS);
    expect(store.getLatestSnapshot("codex")).toEqual(CODEX_METRICS);
    expect(store.getDaemonStatus("claude")).toMatchObject({
      service: "claude",
      lastCollectedAt: "2026-04-09T12:00:00.000Z",
      lastSource: DataSource.API,
      lastError: null,
      consecutiveFailures: 0,
    });
    expect(store.getDaemonStatus("codex")).toMatchObject({
      service: "codex",
      lastCollectedAt: "2026-04-09T12:00:00.000Z",
      lastSource: DataSource.PTY,
      lastError: null,
      consecutiveFailures: 0,
    });
    expect(warnings).toEqual([]);
  });

  test("records refresh failures and continues collecting other services", async () => {
    const claudeChain = new MockChain(new Error("claude CLI unavailable"));
    const codexChain = new MockChain(
      makeSuccessResult(CODEX_METRICS, DataSource.API),
    );
    const warnings: string[] = [];

    const collector = createDaemonCollector({
      services: {
        claude: claudeChain,
        codex: codexChain,
      },
      store,
      logger: {
        warn: (message) => warnings.push(message),
      },
      now: () => new Date("2026-04-09T12:05:00.000Z"),
    });

    await collector.collectOnce();

    expect(store.getLatestSnapshot("claude")).toBeNull();
    expect(store.getDaemonStatus("claude")).toMatchObject({
      service: "claude",
      lastCollectedAt: null,
      lastError: "claude CLI unavailable",
      consecutiveFailures: 1,
    });
    expect(store.getLatestSnapshot("codex")).toEqual(CODEX_METRICS);
    expect(store.getDaemonStatus("codex")).toMatchObject({
      service: "codex",
      lastCollectedAt: "2026-04-09T12:05:00.000Z",
      lastSource: DataSource.API,
      lastError: null,
      consecutiveFailures: 0,
    });
    expect(warnings).toEqual([
      "[claude] collection failed: claude CLI unavailable",
    ]);
  });
});
