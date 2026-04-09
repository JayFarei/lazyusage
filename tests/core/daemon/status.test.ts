import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { DataSource } from "../../../packages/core/src/types.js";
import { UsageStore } from "../../../packages/core/src/storage/database.js";

describe("UsageStore daemon status", () => {
  let store: UsageStore;

  beforeEach(() => {
    store = new UsageStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  test("returns null when no daemon heartbeat exists for a service", () => {
    expect(store.getDaemonStatus("claude")).toBeNull();
  });

  test("stores and reads a successful daemon heartbeat", () => {
    store.recordDaemonHeartbeat("claude", {
      collectedAt: "2026-04-09T10:00:00.000Z",
      source: DataSource.API,
    });

    const status = store.getDaemonStatus("claude");

    expect(status).not.toBeNull();
    expect(status!.service).toBe("claude");
    expect(status!.lastCollectedAt).toBe("2026-04-09T10:00:00.000Z");
    expect(status!.lastSource).toBe(DataSource.API);
    expect(status!.lastError).toBeNull();
    expect(status!.consecutiveFailures).toBe(0);
    expect(status!.pid).toBeNull();
    expect(status!.startedAt).toBeNull();
    expect(status!.updatedAt).toBeString();
  });

  test("checks daemon heartbeat freshness using the last successful collection time", () => {
    const realDateNow = Date.now;
    Date.now = () => new Date("2026-04-09T10:02:00.000Z").getTime();

    store.recordDaemonHeartbeat("claude", {
      collectedAt: "2026-04-09T10:00:30.000Z",
      source: DataSource.API,
    });
    expect(store.isDaemonHeartbeatFresh("claude")).toBe(true);

    store.recordDaemonHeartbeat("claude", {
      error: "rate limited",
    });
    expect(store.isDaemonHeartbeatFresh("claude")).toBe(true);

    store.recordDaemonHeartbeat("codex", {
      collectedAt: "2026-04-09T09:59:59.000Z",
      source: DataSource.PTY,
    });
    expect(store.isDaemonHeartbeatFresh("codex")).toBe(false);

    const status = store.getDaemonStatus("claude");
    expect(status!.lastCollectedAt).toBe("2026-04-09T10:00:30.000Z");
    expect(status!.lastError).toBe("rate limited");
    expect(status!.consecutiveFailures).toBe(1);

    Date.now = realDateNow;
  });
});
