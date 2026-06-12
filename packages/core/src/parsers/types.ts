/**
 * Types for the per-project usage ledger.
 * Shared between parsers, aggregator, worker, and UI components.
 */

export interface SessionTokens {
  project: string; // folder name (last cwd component)
  cwd: string; // full path
  service: "claude" | "codex";
  date: string; // YYYY-MM-DD
  inputTokens: number; // fresh input only (not cache)
  outputTokens: number;
  cacheReadTokens: number; // cache_read_input_tokens (cheap, ~0.1x price)
  cacheCreationTokens: number; // cache_creation_input_tokens (~1.25x price)
  totalTokens: number; // input + output + cacheRead + cacheCreation
}

export interface ProjectUsage {
  project: string;
  totalTokens: number;
  pctOfTotal: number; // % of all tokens across all projects for this period
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}
