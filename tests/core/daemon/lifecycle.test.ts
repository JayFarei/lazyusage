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

  close(): void {
    this.closeCalls += 1;
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
});
