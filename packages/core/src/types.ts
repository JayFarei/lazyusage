/**
 * Core types for usage monitoring.
 * Ported from Python src/providers/base.py
 */

/** Source of usage data */
export enum DataSource {
  API = "api",
  PTY = "pty",
  CACHE = "cache",
  FALLBACK = "fallback",
}

/** Individual metric data (e.g., session, weekly) */
export interface MetricData {
  used_pct: number;
  remaining_pct: number;
  resets: string;
}

/** Generic metrics dict (runtime shape used across providers) */
export type MetricsDict = Record<string, MetricData | string | null>;

/** Result of a usage data fetch operation */
export interface FetchResult {
  metrics: MetricsDict | null;
  source: DataSource;
  timestamp: number;
  error: string | null;
  stale: boolean;
}

/** Claude service metrics */
export interface ClaudeMetrics {
  subscription_type: string | null;
  session: MetricData;
  week_all: MetricData;
  week_sonnet: MetricData;
}

/** Codex service metrics */
export interface CodexMetrics {
  subscription_type: string | null;
  "5h": MetricData;
  weekly: MetricData;
}

/** Union of service metrics */
export type ServiceMetrics = ClaudeMetrics | CodexMetrics;

/** Service name literal */
export type ServiceName = "claude" | "codex";

/** Usage provider interface (ephemeral) */
export interface UsageProvider {
  name: string;
  sourceType: DataSource;
  isAvailable(): boolean;
  fetch(): Promise<FetchResult>;
}

/** Persistent usage provider interface (for TUI) */
export interface PersistentUsageProvider extends UsageProvider {
  start(): Promise<FetchResult>;
  refresh(): Promise<FetchResult>;
  stop(): Promise<void>;
}

/** Ephemeral collector interface */
export interface EphemeralCollector {
  collect(): Promise<MetricsDict>;
}

/** Persistent collector interface */
export interface PersistentCollector {
  start(): Promise<MetricsDict>;
  refresh(): Promise<MetricsDict>;
  stop(): Promise<void>;
}

/** Database snapshot row */
export interface SnapshotRow {
  id: number;
  timestamp: string;
  service: ServiceName;
  metric_name: string;
  used_pct: number;
  remaining_pct: number;
  resets: string | null;
  resets_at: string | null;
  subscription_type: string | null;
  source: string;
  collection_id: string | null;
}

/** History entry returned by getHistory() */
export interface HistoryEntry {
  timestamp: string;
  used_pct: number;
}

/** Claude credential data */
export interface ClaudeCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  subscriptionType: string;
  rateLimitTier: string;
}

/** Codex credential data */
export interface CodexCredentials {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  lastRefresh: string;
}

/** CLI exit codes for machine consumers */
export enum ExitCode {
  SUCCESS = 0,
  FAILURE = 1,
  BINARY_NOT_FOUND = 2,
  PARSE_ERROR = 3,
  TIMEOUT = 4,
}
