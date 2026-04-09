import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import type { DaemonLogLevel } from "./config.js";

export const DEFAULT_DAEMON_LOG_PATH = join(
  homedir(),
  ".local",
  "share",
  "lazyusage",
  "daemon.log",
);

export interface DaemonLoggerOptions {
  logPath?: string;
  level?: DaemonLogLevel;
  maxSizeBytes?: number;
  keepFiles?: number;
  now?: () => Date;
}

export interface DaemonLogger {
  log(level: DaemonLogLevel, message: string): void;
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

const LEVEL_ORDER: Record<DaemonLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const DEFAULT_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP_FILES = 3;

function rotateLogFiles(logPath: string, keepFiles: number): void {
  if (!existsSync(logPath)) {
    return;
  }

  if (keepFiles < 1) {
    rmSync(logPath, { force: true });
    return;
  }

  rmSync(`${logPath}.${keepFiles}`, { force: true });

  for (let index = keepFiles - 1; index >= 1; index -= 1) {
    const rotatedPath = `${logPath}.${index}`;
    if (existsSync(rotatedPath)) {
      renameSync(rotatedPath, `${logPath}.${index + 1}`);
    }
  }

  renameSync(logPath, `${logPath}.1`);
}

export function createDaemonLogger(
  options: DaemonLoggerOptions = {},
): DaemonLogger {
  const logPath = options.logPath ?? DEFAULT_DAEMON_LOG_PATH;
  const level = options.level ?? "info";
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const keepFiles = options.keepFiles ?? DEFAULT_KEEP_FILES;
  const now = options.now ?? (() => new Date());

  const write = (entryLevel: DaemonLogLevel, message: string): void => {
    if (LEVEL_ORDER[entryLevel] > LEVEL_ORDER[level]) {
      return;
    }

    const entry = `${now().toISOString()} [${entryLevel.toUpperCase()}] ${message}\n`;
    mkdirSync(dirname(logPath), { recursive: true });

    if (
      existsSync(logPath) &&
      statSync(logPath).size + Buffer.byteLength(entry, "utf-8") > maxSizeBytes
    ) {
      rotateLogFiles(logPath, keepFiles);
    }

    appendFileSync(logPath, entry, "utf-8");
  };

  return {
    log: write,
    error: (message) => write("error", message),
    warn: (message) => write("warn", message),
    info: (message) => write("info", message),
    debug: (message) => write("debug", message),
  };
}
