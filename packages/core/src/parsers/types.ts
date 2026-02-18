/**
 * Types for the per-project usage ledger.
 * Shared between parsers, aggregator, worker, and UI components.
 */

export interface SessionTokens {
  project: string;           // folder name (last cwd component)
  cwd: string;               // full path
  service: "claude" | "codex";
  date: string;              // YYYY-MM-DD
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;       // input + output
}

export interface ProjectUsage {
  project: string;
  totalTokens: number;
  pctOfTotal: number;        // % of all tokens across all projects for this period
  inputTokens: number;
  outputTokens: number;
}
