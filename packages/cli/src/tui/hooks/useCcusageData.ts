/**
 * Hook for loading ccusage token/cost statistics.
 * Both Claude and Codex data are loaded via subprocesses to avoid blocking
 * the TUI event loop. The ccusage data-loader does heavy synchronous file I/O
 * (createReadStream + readline on hundreds of JSONL files) plus Consola
 * logger output that corrupts terminal rendering.
 *
 * Claude: 2 parallel Bun.spawn workers (batched: daily+monthly, blocks+sessions)
 * Codex:  3 parallel Bun.spawn running bunx @ccusage/codex@latest
 *
 * Results are shown incrementally as each subprocess finishes.
 * 30s throttled refresh, independent of rate-limit polling.
 */
import { createSignal, type Accessor } from "solid-js";
import {
  loadCodexDaily,
  loadCodexSessions,
  loadCodexMonthly,
  killAllCodex,
} from "../lib/codex-ccusage.js";

// ---------- Own type definitions (no branded types from ccusage) ----------

export interface DailyUsage {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalCost: number;
  modelsUsed?: string[];
}

export interface SessionBlock {
  startTime: string;
  endTime: string;
  isActive: boolean;
  isGap: boolean;
  tokenCounts: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
  };
  costUSD: number;
  models: string[];
}

export interface SessionUsage {
  projectPath: string;
  lastActivity: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalCost: number;
  modelsUsed?: string[];
}

export interface MonthlyUsage {
  month: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalCost: number;
  modelsUsed?: string[];
}

export interface CcusageHook {
  claudeDaily: Accessor<DailyUsage[] | null>;
  claudeBlocks: Accessor<SessionBlock[] | null>;
  claudeSessions: Accessor<SessionUsage[] | null>;
  claudeMonthly: Accessor<MonthlyUsage[] | null>;
  codexDaily: Accessor<DailyUsage[] | null>;
  codexSessions: Accessor<SessionUsage[] | null>;
  codexMonthly: Accessor<MonthlyUsage[] | null>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  refresh: (force?: boolean) => Promise<void>;
  killAll: () => void;
}

const THROTTLE_MS = 30_000;
const WORKER_TIMEOUT_MS = 60_000;

/** Resolve path to the ccusage-worker.ts script */
const WORKER_PATH = new URL("../lib/ccusage-worker.ts", import.meta.url).pathname;

/** Track active Claude worker subprocesses for cleanup */
const activeProcs = new Set<{ kill(): void }>();

/**
 * Spawn a batched ccusage worker for multiple data types.
 * Accepts comma-separated commands, returns keyed JSON.
 */
async function runClaudeWorker(commands: string): Promise<Record<string, unknown> | null> {
  try {
    const proc = Bun.spawn(["bun", "run", WORKER_PATH, commands], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    activeProcs.add(proc);
    const timeout = setTimeout(() => proc.kill(), WORKER_TIMEOUT_MS);
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    clearTimeout(timeout);
    activeProcs.delete(proc);

    if (exitCode !== 0) return null;

    const trimmed = stdout.trim();
    if (!trimmed) return null;

    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function useCcusageData(): CcusageHook {
  const [claudeDaily, setClaudeDaily] = createSignal<DailyUsage[] | null>(null);
  const [claudeBlocks, setClaudeBlocks] = createSignal<SessionBlock[] | null>(null);
  const [claudeSessions, setClaudeSessions] = createSignal<SessionUsage[] | null>(null);
  const [claudeMonthly, setClaudeMonthly] = createSignal<MonthlyUsage[] | null>(null);
  const [codexDaily, setCodexDaily] = createSignal<DailyUsage[] | null>(null);
  const [codexSessions, setCodexSessions] = createSignal<SessionUsage[] | null>(null);
  const [codexMonthly, setCodexMonthly] = createSignal<MonthlyUsage[] | null>(null);

  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let lastRefresh = 0;

  async function refresh(force = false) {
    if (loading()) return; // never overlap spawns
    const now = Date.now();
    if (!force && now - lastRefresh < THROTTLE_MS) return;
    lastRefresh = now;
    setLoading(true);
    setError(null);

    try {
      // Launch 5 workers in parallel (2 Claude batched + 3 Codex)
      // Worker A: daily + monthly, Worker B: blocks + sessions
      const claudeA$ = runClaudeWorker("daily,monthly").then((data) => {
        if (data) {
          if (data.daily) setClaudeDaily(data.daily as DailyUsage[]);
          if (data.monthly) setClaudeMonthly(data.monthly as MonthlyUsage[]);
        }
        return data;
      });
      const claudeB$ = runClaudeWorker("blocks,sessions").then((data) => {
        if (data) {
          if (data.blocks) setClaudeBlocks(data.blocks as SessionBlock[]);
          if (data.sessions) setClaudeSessions(data.sessions as SessionUsage[]);
        }
        return data;
      });

      const codexDaily$ = loadCodexDaily()
        .then((data) => { setCodexDaily(data as DailyUsage[] | null); return data; });
      const codexSessions$ = loadCodexSessions()
        .then((data) => { setCodexSessions(data as SessionUsage[] | null); return data; });
      const codexMonthly$ = loadCodexMonthly()
        .then((data) => { setCodexMonthly(data as MonthlyUsage[] | null); return data; });

      // Wait for all to complete
      const results = await Promise.allSettled([
        claudeA$, claudeB$,
        codexDaily$, codexSessions$, codexMonthly$,
      ]);

      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      if (failures.length > 0) {
        setError(`${failures.length} ccusage loader(s) failed`);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  /** Kill all active worker subprocesses (Claude + Codex) */
  function killAll() {
    for (const proc of activeProcs) {
      try { proc.kill(); } catch {}
    }
    activeProcs.clear();
    killAllCodex();
  }

  return {
    claudeDaily,
    claudeBlocks,
    claudeSessions,
    claudeMonthly,
    codexDaily,
    codexSessions,
    codexMonthly,
    loading,
    error,
    refresh,
    killAll,
  };
}
