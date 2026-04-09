import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createDaemonLifecycle } from "../../../packages/core/src/daemon/lifecycle.js";

class MockCollector {
  startCalls = 0;
  stopCalls = 0;

  async start(): Promise<void> {
    this.startCalls += 1;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
  }
}

class MockStore {
  closeCalls = 0;
  heartbeatCalls: Array<{
    service: "_daemon";
    input: {
      pid?: number | null;
      startedAt?: string | null;
    };
  }> = [];

  close(): void {
    this.closeCalls += 1;
  }

  recordDaemonHeartbeat(
    service: "_daemon",
    input: {
      pid?: number | null;
      startedAt?: string | null;
    },
  ): void {
    this.heartbeatCalls.push({ service, input });
  }
}

class MockBackgroundProcess {
  constructor(readonly pid: number) {}

  unrefCalls = 0;

  unref(): void {
    this.unrefCalls += 1;
  }
}

describe("createDaemonLifecycle", () => {
  let tempDir: string;
  let pidFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lazyusage-daemon-lifecycle-"));
    pidFilePath = join(tempDir, "run", "daemon.pid");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("starts the collector in the foreground, writes a PID file, and registers shutdown signals", async () => {
    const collector = new MockCollector();
    const store = new MockStore();
    const registeredSignals: string[] = [];

    const lifecycle = createDaemonLifecycle({
      collector,
      store,
      logger: { warn: () => {} },
      pidFilePath,
      pid: 4321,
      onSignal: (signal) => {
        registeredSignals.push(signal);
      },
    });

    await lifecycle.startForeground();

    expect(collector.startCalls).toBe(1);
    expect(existsSync(pidFilePath)).toBe(true);
    expect(readFileSync(pidFilePath, "utf-8")).toBe("4321\n");
    expect(registeredSignals).toEqual(["SIGINT", "SIGTERM"]);
  });

  test("records daemon process metadata when foreground startup succeeds", async () => {
    const collector = new MockCollector();
    const store = new MockStore();

    const lifecycle = createDaemonLifecycle({
      collector,
      store,
      logger: { warn: () => {} },
      pidFilePath,
      pid: 4321,
    });

    await lifecycle.startForeground();

    expect(store.heartbeatCalls).toHaveLength(1);
    expect(store.heartbeatCalls[0]?.service).toBe("_daemon");
    expect(store.heartbeatCalls[0]?.input.pid).toBe(4321);
    expect(store.heartbeatCalls[0]?.input.startedAt).toBeString();
    expect(Date.parse(store.heartbeatCalls[0]?.input.startedAt ?? "")).not.toBeNaN();
  });

  test("shuts down cleanly when a registered signal fires", async () => {
    const collector = new MockCollector();
    const store = new MockStore();
    const signalHandlers = new Map<string, () => Promise<void>>();

    const lifecycle = createDaemonLifecycle({
      collector,
      store,
      logger: { warn: () => {} },
      pidFilePath,
      pid: 4321,
      onSignal: (signal, handler) => {
        signalHandlers.set(signal, handler);
      },
      offSignal: (signal) => {
        signalHandlers.delete(signal);
      },
    });

    await lifecycle.startForeground();
    await signalHandlers.get("SIGTERM")?.();

    expect(collector.stopCalls).toBe(1);
    expect(store.closeCalls).toBe(1);
    expect(existsSync(pidFilePath)).toBe(false);
    expect(signalHandlers.size).toBe(0);
  });

  test("spawns a detached background daemon process and returns its pid", async () => {
    const collector = new MockCollector();
    const store = new MockStore();
    const child = new MockBackgroundProcess(9876);
    let spawnInput:
      | {
          command: string[];
          cwd?: string;
          env?: Record<string, string | undefined>;
        }
      | null = null;

    const lifecycle = createDaemonLifecycle({
      collector,
      store,
      logger: { warn: () => {} },
      pidFilePath,
      spawnBackground: (input) => {
        spawnInput = input;
        return child;
      },
    });

    const pid = await lifecycle.startBackground({
      command: ["bun", "run", "lazyusage", "daemon", "start", "--foreground"],
      cwd: tempDir,
      env: {
        LAZYUSAGE_DB_PATH: join(tempDir, "usage.db"),
      },
    });

    expect(pid).toBe(9876);
    expect(collector.startCalls).toBe(0);
    expect(existsSync(pidFilePath)).toBe(false);
    expect(spawnInput).toEqual({
      command: ["bun", "run", "lazyusage", "daemon", "start", "--foreground"],
      cwd: tempDir,
      env: {
        LAZYUSAGE_DB_PATH: join(tempDir, "usage.db"),
      },
    });
    expect(child.unrefCalls).toBe(1);
  });
});
