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

export interface DaemonBackgroundLaunchOptions {
  command: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

interface DaemonBackgroundProcess {
  pid: number;
  unref?: () => void;
}

export interface DaemonLifecycle {
  startBackground(options: DaemonBackgroundLaunchOptions): Promise<number>;
  startForeground(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface DaemonLifecycleOptions {
  collector: Pick<DaemonCollector, "start" | "stop">;
  store: Pick<UsageStore, "close"> &
    Partial<Pick<UsageStore, "recordDaemonHeartbeat">>;
  logger: Pick<DaemonLogger, "warn">;
  pidFilePath?: string;
  pid?: number;
  onSignal?: (signal: DaemonSignal, handler: DaemonSignalHandler) => void;
  offSignal?: (signal: DaemonSignal, handler: DaemonSignalHandler) => void;
  spawnBackground?: (
    options: DaemonBackgroundLaunchOptions,
  ) => DaemonBackgroundProcess;
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
  const spawnBackground =
    options.spawnBackground ??
    ((input: DaemonBackgroundLaunchOptions): DaemonBackgroundProcess =>
      Bun.spawn(input.command, {
        cwd: input.cwd,
        env: input.env,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        detached: true,
      }));

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
    async startBackground(
      input: DaemonBackgroundLaunchOptions,
    ): Promise<number> {
      const child = spawnBackground(input);
      child.unref?.();
      return child.pid;
    },

    async startForeground(): Promise<void> {
      if (started) {
        return;
      }

      const startedAt = new Date().toISOString();
      mkdirSync(dirname(pidFilePath), { recursive: true });
      writeFileSync(pidFilePath, `${pid}\n`, "utf-8");

      for (const signal of SHUTDOWN_SIGNALS) {
        const handler: DaemonSignalHandler = () => shutdown();
        signalHandlers.set(signal, handler);
        onSignal(signal, handler);
      }

      try {
        await options.collector.start();
        options.store.recordDaemonHeartbeat?.("_daemon", {
          pid,
          startedAt,
        });
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
