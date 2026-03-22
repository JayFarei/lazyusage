/** Shared constants for the lazyusage monorepo */

/** Hours in a weekly window (7 days * 24 hours) */
export const WEEKLY_WINDOW_HOURS = 168;

/** Hours in a session window (5 hours) */
export const SESSION_WINDOW_HOURS = 5;

/** Default API request timeout in milliseconds */
export const API_TIMEOUT_MS = 10_000;

/** Default retry-after duration in seconds when no header provided.
 * The Anthropic usage API allows ~1 request per 3-4 minutes. */
export const RATE_LIMIT_DEFAULT_SECONDS = 240;

/** TUI tick interval in milliseconds (30 seconds) */
export const TICK_INTERVAL_MS = 30_000;

/** Human-readable labels for DataSource enum values */
export const DATA_SOURCE_LABELS: Record<string, string> = {
  api: "API",
  pty: "Terminal",
  cache: "Cached",
  fallback: "Offline",
};

/** Codex plan type display names (shared by API and session providers) */
export const CODEX_PLAN_TYPE_MAP: Record<string, string> = {
  plus: "Plus",
  pro: "Pro",
  free: "Free",
  go: "Go",
  team: "Team",
  business: "Business",
  enterprise: "Enterprise",
};
