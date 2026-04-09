import { Command } from "commander";

export interface DaemonStartOptions {
  interval?: number;
  services?: string[];
  foreground?: boolean;
  logLevel?: string;
}

export interface DaemonCommandOptions {
  onStart?: (options: DaemonStartOptions) => Promise<void> | void;
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
      await options.onStart?.({
        interval: parseInterval(input.interval),
        services: parseServices(input.services),
        foreground: input.foreground,
        logLevel: input.logLevel,
      });
    });

  return command;
}
