import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ServiceName } from "../types.js";

export type DaemonLogLevel = "error" | "warn" | "info" | "debug";

export interface DaemonConfig {
  interval: number;
  services: ServiceName[];
  logLevel: DaemonLogLevel;
  ptyRecycleHours: number;
  configPath: string;
}

export interface DaemonConfigOverrides {
  configPath?: string;
  interval?: number;
  services?: ServiceName[];
  logLevel?: DaemonLogLevel;
  ptyRecycleHours?: number;
}

export const DEFAULT_DAEMON_CONFIG_PATH = join(homedir(), ".config", "lazyusage", "daemon.toml");

interface ParsedDaemonConfigFile {
  interval?: unknown;
  services?: unknown;
  log_level?: unknown;
  pty?: {
    recycle_hours?: unknown;
  };
}

function isServiceName(value: unknown): value is ServiceName {
  return value === "claude" || value === "codex";
}

function parseServices(value: unknown): ServiceName[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const services = value.filter(isServiceName);
  return services.length === value.length ? services : undefined;
}

function parseLogLevel(value: unknown): DaemonLogLevel | undefined {
  if (value === "error" || value === "warn" || value === "info" || value === "debug") {
    return value;
  }
  if (value === "warning") {
    return "warn";
  }
  return undefined;
}

export function loadDaemonConfig(overrides: DaemonConfigOverrides = {}): DaemonConfig {
  const configPath = overrides.configPath ?? DEFAULT_DAEMON_CONFIG_PATH;
  const fileConfig: ParsedDaemonConfigFile = existsSync(configPath)
    ? (Bun.TOML.parse(readFileSync(configPath, "utf-8")) as ParsedDaemonConfigFile)
    : {};

  const interval = typeof fileConfig.interval === "number" ? fileConfig.interval : undefined;
  const services = parseServices(fileConfig.services);
  const logLevel = parseLogLevel(fileConfig.log_level);
  const ptyRecycleHours = typeof fileConfig.pty?.recycle_hours === "number" ? fileConfig.pty.recycle_hours : undefined;

  return {
    interval: overrides.interval ?? interval ?? 60,
    services: overrides.services ?? services ?? ["claude", "codex"],
    logLevel: overrides.logLevel ?? logLevel ?? "info",
    ptyRecycleHours: overrides.ptyRecycleHours ?? ptyRecycleHours ?? 4,
    configPath,
  };
}
