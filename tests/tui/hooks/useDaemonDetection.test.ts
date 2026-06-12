import { describe, expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { useDaemonDetection } from "../../../packages/cli/src/tui/hooks/useDaemonDetection.js";
import { mockClaudeMetrics, mockCodexMetrics } from "../helpers.js";

describe("useDaemonDetection", () => {
  test("loads daemon-backed snapshots only for services with fresh heartbeats", () => {
    const claudeMetrics = mockClaudeMetrics();
    let closed = false;
    const freshnessChecks: string[] = [];
    const snapshotReads: string[] = [];

    createRoot((dispose) => {
      const detection = useDaemonDetection({
        readPidFile: (path) => {
          expect(path).toContain("daemon.pid");
          return "4321\n";
        },
        isProcessRunning: (pid) => pid === 4321,
        createStore: () => ({
          isDaemonHeartbeatFresh: (service) => {
            freshnessChecks.push(service);
            return service === "claude";
          },
          getLatestSnapshot: (service) => {
            snapshotReads.push(service);
            if (service === "claude") {
              return claudeMetrics;
            }

            return mockCodexMetrics();
          },
          close: () => {
            closed = true;
          },
        }),
      });

      detection.detect();

      expect(detection.daemonHealthy()).toBe(true);
      expect(detection.daemonBackedServices()).toEqual({
        claude: true,
        codex: false,
      });
      expect(detection.daemonMetrics()).toEqual({
        claude: claudeMetrics,
      });
      expect(freshnessChecks).toEqual(["claude", "codex"]);
      expect(snapshotReads).toEqual(["claude"]);
      expect(closed).toBe(true);

      dispose();
    });
  });

  test("stays inactive when the pid file is missing", () => {
    let storeCreated = false;

    createRoot((dispose) => {
      const detection = useDaemonDetection({
        readPidFile: () => {
          throw new Error("missing pid");
        },
        createStore: () => {
          storeCreated = true;
          throw new Error("store should not be created");
        },
      });

      detection.detect();

      expect(detection.daemonHealthy()).toBe(false);
      expect(detection.daemonBackedServices()).toEqual({
        claude: false,
        codex: false,
      });
      expect(detection.daemonMetrics()).toEqual({});
      expect(storeCreated).toBe(false);

      dispose();
    });
  });
});
