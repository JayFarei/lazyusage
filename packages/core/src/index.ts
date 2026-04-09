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
  ServiceResourceInfo,
  UsageProvider,
  PersistentUsageProvider,
  EphemeralCollector,
  PersistentCollector,
  SnapshotRow,
  HistoryEntry,
  ClaudeCredentials,
  CodexCredentials,
  Regime,
  DailyBoundary,
  DailyDelta,
  CapacityPrediction,
  SupervisedMark,
  PredictionBarSegments,
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
  createPredictionBar,
} from "./utils/bars.js";

export {
  EphemeralSession,
  PersistentSession,
} from "./utils/tmux.js";

export {
  DirectSession,
  PersistentDirectSession,
} from "./utils/pty.js";

// Parsers
export { parseClaudeOutput } from "./parsers/claude.js";
export { parseCodexOutput } from "./parsers/codex.js";

// Storage
export { UsageStore } from "./storage/database.js";
export { buildPaceData, type PacePoint, type PaceData } from "./storage/pace.js";
export { DedupTracker } from "./storage/dedup.js";

// Daemon
export {
  DEFAULT_DAEMON_CONFIG_PATH,
  loadDaemonConfig,
  type DaemonConfig,
  type DaemonConfigOverrides,
  type DaemonLogLevel,
} from "./daemon/config.js";

// Providers
export { createClaudeChain, createCodexChain } from "./providers/factory.js";
export { FallbackChain, PersistentFallbackChain, SourcePlanner, setChainDiagnosticListener } from "./providers/chain.js";
export type { SourcePlan, ChainDiagnosticEvent, ChainDiagnosticListener } from "./providers/chain.js";

// Collectors
export { ClaudeEphemeralCollector, ClaudePersistentCollector } from "./collectors/claude.js";
export { CodexEphemeralCollector, CodexPersistentCollector } from "./collectors/codex.js";

// Formatters
export { formatClaudeText, formatCodexText, formatWithAvailability, formatClaudeCapacityText, formatCodexCapacityText, formatCapacityWithAvailability, formatPredictionText, formatPredictionCapacitySuffix } from "./formatters/text.js";
export { formatJson, formatAllJson, formatCombinedJson, formatCombinedCapacityJson } from "./formatters/json.js";

// Constants
export { WEEKLY_WINDOW_HOURS, SESSION_WINDOW_HOURS, API_TIMEOUT_MS, RATE_LIMIT_DEFAULT_SECONDS, TICK_INTERVAL_MS, DATA_SOURCE_LABELS, CODEX_PLAN_TYPE_MAP, REGIME_RATES, COLD_START_RATE } from "./constants.js";

// Prediction
export { computeDailyDeltas } from "./prediction/deltas.js";
export { predict } from "./prediction/project.js";

// Credentials
export { ClaudeCredentialStore, CodexCredentialStore, RefreshFailureGate } from "./providers/credentials.js";

// Providers
export { ClaudeAPIProvider } from "./providers/api-claude.js";
export { CodexAPIProvider } from "./providers/api-codex.js";
export { ClaudeWebProvider } from "./providers/web-claude.js";

// Cookie extraction
export { getClaudeSessionCookie, invalidateClaudeSessionCookie } from "./utils/cookies.js";

// Status page polling
export { pollStatusPage, pollAllStatusPages, statusToWarningMessage, type StatusPageResult } from "./providers/status-page.js";

// Warnings
export { detectWarning, detectLimitAdjustment, formatWarningCompact, formatWarningStderr, type ServiceWarning } from "./utils/warnings.js";

// Redact
export { redact } from "./utils/redact.js";

// Logger
export { logger, setLogLevel, getLogLevel, type LogLevel } from "./utils/logger.js";
