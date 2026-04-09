import { Command } from "commander";
import { existsSync, readFileSync } from "fs";
import {
  DEFAULT_DAEMON_PID_PATH,
  loadDaemonConfig,
  type DaemonConfig,
  type DaemonConfigOverrides,
  type DaemonLogLevel,
  type ServiceName,
} from "@lazyusage/core";

export interface DaemonStartOptions {
  interval?: number;
  services?: string[];
  foreground?: boolean;
  logLevel?: string;
}

export interface DaemonCommandOptions {
  onStart?: (options: DaemonStartOptions) => Promise<void> | void;
  loadConfig?: (overrides: DaemonConfigOverrides) => DaemonConfig;
  startForeground?: (config: DaemonConfig) => Promise<void> | void;
  startBackground?: (config: DaemonConfig) => Promise<number> | number;
  pidFilePath?: string;
  readPidFile?: (path: string) => string;
  signalProcess?: (pid: number, signal: "SIGTERM") => void;
  isProcessRunning?: (pid: number) => boolean;
  waitForProcessExit?: (pid: number) => Promise<void>;
  writeStdout?: (message: string) => void;
  stopTimeoutMs?: number;
  stopPollIntervalMs?: number;
}

function isServiceName(value: string): value is ServiceName {
  return value === "claude" || value === "codex";
}

function parseServices(input?: string): string[] | undefined {
  if (!input) {
    return undefined;
  }

  const services = input
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);

  return services.length > 0 ? services : undefined;
}

function parseInterval(input?: string): number | undefined {
  if (!input) {
    return undefined;
  }

  const interval = Number.parseInt(input, 10);
  return Number.isFinite(interval) ? interval : undefined;
}

function parseLogLevelOverride(input?: string): DaemonLogLevel | undefined {
  if (
    input === "error"
    || input === "warn"
    || input === "info"
    || input === "debug"
  ) {
    return input;
  }

  return undefined;
}

function parseServiceOverrides(input?: string[]): ServiceName[] | undefined {
  if (!input || !input.every(isServiceName)) {
    return undefined;
  }

  return input;
}

function parsePid(pidContents: string): number {
  const pid = Number.parseInt(pidContents.trim(), 10);

  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Daemon PID file is invalid.");
  }

  return pid;
}

export function createDaemonCommand(
  options: DaemonCommandOptions = {},
): Command {
  const pidFilePath = options.pidFilePath ?? DEFAULT_DAEMON_PID_PATH;
  const readPidFile =
    options.readPidFile ??
    ((path: string): string => {
      if (!existsSync(path)) {
        throw new Error("Daemon is not running.");
      }

      return readFileSync(path, "utf-8");
    });
  const signalProcess =
    options.signalProcess ??
    ((pid: number, signal: "SIGTERM"): void => {
      process.kill(pid, signal);
    });
  const isProcessRunning =
    options.isProcessRunning ??
    ((pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  const writeStdout = options.writeStdout ?? ((message: string) => console.log(message));
  const waitForProcessExit =
    options.waitForProcessExit ??
    (async (pid: number): Promise<void> => {
      const timeoutMs = options.stopTimeoutMs ?? 5000;
      const pollIntervalMs = options.stopPollIntervalMs ?? 100;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (!isProcessRunning(pid)) {
          return;
        }

        await Bun.sleep(pollIntervalMs);
      }

      if (isProcessRunning(pid)) {
        throw new Error(`Timed out waiting for daemon ${pid} to exit.`);
      }
    });

  const command = new Command("daemon")
    .description("Manage the always-on collector daemon");

  command
    .command("start")
    .description("Start the collector daemon")
    .option("--interval <seconds>", "Collection interval in seconds")
    .option("--services <services>", "Comma-separated services to collect")
    .option("--foreground", "Run in the foreground instead of forking")
    .option("--log-level <level>", "Daemon log level")
    .action(async (input: {
      interval?: string;
      services?: string;
      foreground?: boolean;
      logLevel?: string;
    }) => {
      const startOptions: DaemonStartOptions = {
        interval: parseInterval(input.interval),
        services: parseServices(input.services),
        foreground: input.foreground,
        logLevel: input.logLevel,
      };

      if (options.onStart) {
        await options.onStart(startOptions);
        return;
      }

      const config = (options.loadConfig ?? loadDaemonConfig)({
        interval: startOptions.interval,
        services: parseServiceOverrides(startOptions.services),
        logLevel: parseLogLevelOverride(startOptions.logLevel),
      });

      if (startOptions.foreground) {
        await options.startForeground?.(config);
        return;
      }

      await options.startBackground?.(config);
    });

  command
    .command("stop")
    .description("Stop the collector daemon")
    .action(async () => {
      const pid = parsePid(readPidFile(pidFilePath));
      signalProcess(pid, "SIGTERM");
      await waitForProcessExit(pid);
      writeStdout(`Stopped daemon ${pid}.`);
    });

  return command;
}
