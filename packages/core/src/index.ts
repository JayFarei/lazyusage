/**
 * @lazyusage/core - Core library for usage monitoring
 *
 * Public API barrel export
 */

export {
  createTimeAxisTicks,
  renderUsageChart,
  type TimeAxisTick,
  type UsageChartOptions,
  type UsageChartRender,
} from "./chart/axes.js";
// Chart
export {
  BRAILLE_EMPTY,
  type BrailleCanvas,
  createBrailleCanvas,
} from "./chart/braille.js";
export {
  mapPointToBrailleCanvas,
  mapTimeToCellColumn,
  mapValueToCellRow,
  plotTimeSeries,
  type TimeSeriesPlotRange,
  type TimeSeriesPoint,
} from "./chart/timeseries.js";
// Collectors
export { ClaudeEphemeralCollector, ClaudePersistentCollector } from "./collectors/claude.js";
export { CodexEphemeralCollector, CodexPersistentCollector } from "./collectors/codex.js";
// Constants
export {
  API_TIMEOUT_MS,
  CODEX_PLAN_TYPE_MAP,
  COLD_START_RATE,
  DATA_SOURCE_LABELS,
  RATE_LIMIT_DEFAULT_SECONDS,
  REGIME_RATES,
  SESSION_WINDOW_HOURS,
  TICK_INTERVAL_MS,
  WEEKLY_WINDOW_HOURS,
} from "./constants.js";
export {
  createDaemonCollector,
  type DaemonCollector,
  type DaemonCollectorChain,
  type DaemonCollectorOptions,
} from "./daemon/collector.js";
// Daemon
export {
  type DaemonConfig,
  type DaemonConfigOverrides,
  type DaemonLogLevel,
  DEFAULT_DAEMON_CONFIG_PATH,
  loadDaemonConfig,
} from "./daemon/config.js";
export {
  createDaemonLifecycle,
  type DaemonLifecycle,
  type DaemonLifecycleOptions,
  DEFAULT_DAEMON_PID_PATH,
} from "./daemon/lifecycle.js";
export {
  createDaemonLogger,
  type DaemonLogger,
  type DaemonLoggerOptions,
  DEFAULT_DAEMON_LOG_PATH,
} from "./daemon/logger.js";
export { formatAllJson, formatCombinedCapacityJson, formatCombinedJson, formatJson } from "./formatters/json.js";
// Formatters
export {
  formatCapacityWithAvailability,
  formatClaudeCapacityText,
  formatClaudeText,
  formatCodexCapacityText,
  formatCodexText,
  formatPredictionCapacitySuffix,
  formatPredictionText,
  formatWithAvailability,
} from "./formatters/text.js";
// Parsers
export { parseClaudeOutput } from "./parsers/claude.js";
export { parseCodexOutput } from "./parsers/codex.js";
// Prediction
export { computeDailyDeltas } from "./prediction/deltas.js";
export { predict } from "./prediction/project.js";
// Providers
export { ClaudeAPIProvider } from "./providers/api-claude.js";
export { CodexAPIProvider } from "./providers/api-codex.js";
export type { ChainDiagnosticEvent, ChainDiagnosticListener, SourcePlan } from "./providers/chain.js";
export {
  FallbackChain,
  PersistentFallbackChain,
  SourcePlanner,
  setChainDiagnosticListener,
} from "./providers/chain.js";
// Credentials
export { ClaudeCredentialStore, CodexCredentialStore, RefreshFailureGate } from "./providers/credentials.js";
// Providers
export { createClaudeChain, createCodexChain } from "./providers/factory.js";
// Status page polling
export {
  pollAllStatusPages,
  pollStatusPage,
  type StatusPageResult,
  statusToWarningMessage,
} from "./providers/status-page.js";
export { ClaudeWebProvider } from "./providers/web-claude.js";
// Storage
export { UsageStore } from "./storage/database.js";
export { DedupTracker } from "./storage/dedup.js";
export {
  buildPaceData,
  getWindowHoursForMetric,
  type PaceBuildOptions,
  type PaceData,
  type PacePoint,
} from "./storage/pace.js";
// Types
export type {
  CapacityPrediction,
  ClaudeCredentials,
  ClaudeMetrics,
  CodexCredentials,
  CodexMetrics,
  DailyBoundary,
  DailyDelta,
  EphemeralCollector,
  FetchResult,
  HistoryEntry,
  MetricData,
  MetricsDict,
  PersistentCollector,
  PersistentUsageProvider,
  PredictionBarSegments,
  Regime,
  ServiceMetrics,
  ServiceName,
  ServiceResourceInfo,
  SnapshotRow,
  SupervisedMark,
  UsageProvider,
} from "./types.js";
export { DataSource, ExitCode } from "./types.js";
export {
  BAR_WIDTH_STEP,
  calculateBarWidth,
  createCapacityBar,
  createPeriodBar,
  createPredictionBar,
  createTimeMarkers,
  MAX_BAR_WIDTH,
  MIN_BAR_WIDTH,
  MIN_TERMINAL_HEIGHT,
  MIN_TERMINAL_WIDTH,
} from "./utils/bars.js";
// Cookie extraction
export { getClaudeSessionCookie, invalidateClaudeSessionCookie } from "./utils/cookies.js";
// Logger
export { getLogLevel, type LogLevel, logger, setLogLevel } from "./utils/logger.js";
export {
  DirectSession,
  PersistentDirectSession,
} from "./utils/pty.js";
// Redact
export { redact } from "./utils/redact.js";
// Utils
export {
  calculateFallbackTime,
  calculateTimeProgress,
  format12hTime,
  formatResetDate,
  formatResetFromIso,
  formatTimeRemaining,
  parseTimeToDatetime,
} from "./utils/time.js";
export {
  EphemeralSession,
  PersistentSession,
} from "./utils/tmux.js";
// Warnings
export {
  detectLimitAdjustment,
  detectWarning,
  formatWarningCompact,
  formatWarningStderr,
  type ServiceWarning,
} from "./utils/warnings.js";
