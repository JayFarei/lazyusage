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

export { DataSource } from "./types.js";

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
export { DedupTracker } from "./storage/dedup.js";

// Providers
export { createClaudeChain, createCodexChain } from "./providers/factory.js";
export { FallbackChain, PersistentFallbackChain } from "./providers/chain.js";

// Collectors
export { ClaudeEphemeralCollector, ClaudePersistentCollector } from "./collectors/claude.js";
export { CodexEphemeralCollector, CodexPersistentCollector } from "./collectors/codex.js";

// Formatters
export { formatClaudeText, formatCodexText, formatAllText, formatWithAvailability } from "./formatters/text.js";
export { formatJson, formatAllJson, formatCombinedJson } from "./formatters/json.js";

// Credentials
export { ClaudeCredentialStore, CodexCredentialStore } from "./providers/credentials.js";
