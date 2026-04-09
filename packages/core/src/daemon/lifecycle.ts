import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import type { UsageStore } from "../storage/database.js";
import type { DaemonCollector } from "./collector.js";
import type { DaemonLogger } from "./logger.js";

export const DEFAULT_DAEMON_PID_PATH = join(
  homedir(),
  ".local",
  "share",
  "lazyusage",
  "daemon.pid",
);

type DaemonSignal = "SIGINT" | "SIGTERM";
type DaemonSignalHandler = () => Promise<void>;

export interface DaemonLifecycle {
  startForeground(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface DaemonLifecycleOptions {
  collector: Pick<DaemonCollector, "start" | "stop">;
  store: Pick<UsageStore, "close">;
  logger: Pick<DaemonLogger, "warn">;
  pidFilePath?: string;
  pid?: number;
  onSignal?: (signal: DaemonSignal, handler: DaemonSignalHandler) => void;
  offSignal?: (signal: DaemonSignal, handler: DaemonSignalHandler) => void;
}

const SHUTDOWN_SIGNALS: DaemonSignal[] = ["SIGINT", "SIGTERM"];

export function createDaemonLifecycle(
  options: DaemonLifecycleOptions,
): DaemonLifecycle {
  const pidFilePath = options.pidFilePath ?? DEFAULT_DAEMON_PID_PATH;
  const pid = options.pid ?? process.pid;
  const onSignal =
    options.onSignal ??
    ((signal: DaemonSignal, handler: DaemonSignalHandler) => {
      process.on(signal, handler);
    });
  const offSignal =
    options.offSignal ??
    ((signal: DaemonSignal, handler: DaemonSignalHandler) => {
      process.off(signal, handler);
    });

  let started = false;
  let shuttingDown = false;
  const signalHandlers = new Map<DaemonSignal, DaemonSignalHandler>();

  const unregisterSignals = (): void => {
    for (const [signal, handler] of signalHandlers) {
      offSignal(signal, handler);
    }
    signalHandlers.clear();
  };

  const shutdown = async (): Promise<void> => {
    if (!started || shuttingDown) {
      return;
    }

    shuttingDown = true;
    unregisterSignals();

    try {
      await options.collector.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.logger.warn(`[lifecycle] shutdown failed: ${message}`);
    }

    try {
      options.store.close();
    } finally {
      if (existsSync(pidFilePath)) {
        rmSync(pidFilePath, { force: true });
      }
      started = false;
      shuttingDown = false;
    }
  };

  return {
    async startForeground(): Promise<void> {
      if (started) {
        return;
      }

      mkdirSync(dirname(pidFilePath), { recursive: true });
      writeFileSync(pidFilePath, `${pid}\n`, "utf-8");

      for (const signal of SHUTDOWN_SIGNALS) {
        const handler: DaemonSignalHandler = () => shutdown();
        signalHandlers.set(signal, handler);
        onSignal(signal, handler);
      }

      try {
        await options.collector.start();
        started = true;
      } catch (error) {
        unregisterSignals();
        rmSync(pidFilePath, { force: true });
        throw error;
      }
    },

    shutdown,
  };
}
