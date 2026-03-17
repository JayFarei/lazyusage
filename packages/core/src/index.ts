/**
 * @lazyusage/core - Core library for usage monitoring
 *
 * Public API barrel export
 */

// Types
export type {
  MetricData,
  FetchResult,
  ClaudeMetrics,
  CodexMetrics,
  ServiceMetrics,
  ServiceName,
  MetricsDict,
  UsageProvider,
  PersistentUsageProvider,
  EphemeralCollector,
  PersistentCollector,
  SnapshotRow,
  HistoryEntry,
  ClaudeCredentials,
  CodexCredentials,
} from "./types.js";

export { DataSource, ExitCode } from "./types.js";

// Utils
export {
  format12hTime,
  formatResetDate,
  calculateFallbackTime,
  parseTimeToDatetime,
  formatResetFromIso,
  calculateTimeProgress,
  formatTimeRemaining,
} from "./utils/time.js";

export {
  BAR_WIDTH_STEP,
  MIN_BAR_WIDTH,
  MAX_BAR_WIDTH,
  MIN_TERMINAL_WIDTH,
  MIN_TERMINAL_HEIGHT,
  calculateBarWidth,
  createTimeMarkers,
  createCapacityBar,
  createPeriodBar,
} from "./utils/bars.js";

export {
  EphemeralSession,
  PersistentSession,
} from "./utils/tmux.js";

// Parsers
export { parseClaudeOutput } from "./parsers/claude.js";
export { parseCodexOutput } from "./parsers/codex.js";

// Storage
export { UsageStore } from "./storage/database.js";
export { buildPaceData, type PacePoint, type PaceData } from "./storage/pace.js";
export { DedupTracker } from "./storage/dedup.js";

// Providers
export { createClaudeChain, createCodexChain } from "./providers/factory.js";
export { FallbackChain, PersistentFallbackChain, SourcePlanner } from "./providers/chain.js";
export type { SourcePlan } from "./providers/chain.js";

// Collectors
export { ClaudeEphemeralCollector, ClaudePersistentCollector } from "./collectors/claude.js";
export { CodexEphemeralCollector, CodexPersistentCollector } from "./collectors/codex.js";

// Formatters
export { formatClaudeText, formatCodexText, formatWithAvailability, formatClaudeCapacityText, formatCodexCapacityText, formatCapacityWithAvailability } from "./formatters/text.js";
export { formatJson, formatAllJson, formatCombinedJson, formatCombinedCapacityJson } from "./formatters/json.js";

// Constants
export { WEEKLY_WINDOW_HOURS, SESSION_WINDOW_HOURS, API_TIMEOUT_MS, RATE_LIMIT_DEFAULT_SECONDS, TICK_INTERVAL_MS } from "./constants.js";

// Credentials
export { ClaudeCredentialStore, CodexCredentialStore, RefreshFailureGate } from "./providers/credentials.js";

// Status page polling
export { pollStatusPage, pollAllStatusPages, statusToWarningMessage, type StatusPageResult } from "./providers/status-page.js";

// Warnings
export { detectWarning, detectLimitAdjustment, formatWarningCompact, formatWarningStderr, type ServiceWarning } from "./utils/warnings.js";

// Redact
export { redact } from "./utils/redact.js";

// Logger
export { logger, setLogLevel, getLogLevel, type LogLevel } from "./utils/logger.js";
