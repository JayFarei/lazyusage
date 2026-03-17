/** Lightweight logger for CLI output. All output goes to stderr. */
export type LogLevel = "error" | "warning" | "info" | "debug" | "trace";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

let currentLevel: LogLevel = "warning";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[currentLevel];
}

export const logger = {
  error(...args: unknown[]) {
    if (shouldLog("error")) console.error("[ERROR]", ...args);
  },
  warn(...args: unknown[]) {
    if (shouldLog("warning")) console.error("[WARN]", ...args);
  },
  info(...args: unknown[]) {
    if (shouldLog("info")) console.error("[INFO]", ...args);
  },
  debug(...args: unknown[]) {
    if (shouldLog("debug")) console.error("[DEBUG]", ...args);
  },
  trace(...args: unknown[]) {
    if (shouldLog("trace")) console.error("[TRACE]", ...args);
  },
};
