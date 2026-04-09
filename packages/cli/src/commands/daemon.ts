import { Command } from "commander";
import {
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

export function createDaemonCommand(
  options: DaemonCommandOptions = {},
): Command {
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

  return command;
}
