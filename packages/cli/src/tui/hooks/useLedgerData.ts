/**
 * Hook for loading per-project usage ledger data.
 * Replaces useCcusageData.ts.
 *
 * Spawns a single ledger-worker subprocess that parses JSONL files
 * from ~/.claude/projects/ and ~/.codex/sessions/ directly.
 *
 * 30s throttled refresh, independent of rate-limit polling.
 */
import { createSignal, type Accessor } from "solid-js";
import { existsSync } from "fs";
import type { ProjectUsage } from "@lazyusage/core/parsers/types";

export interface LedgerHook {
  claudeDaily: Accessor<ProjectUsage[] | null>;
  claudeWeekly: Accessor<ProjectUsage[] | null>;
  claudeMonthly: Accessor<ProjectUsage[] | null>;
  codexDaily: Accessor<ProjectUsage[] | null>;
  codexWeekly: Accessor<ProjectUsage[] | null>;
  codexMonthly: Accessor<ProjectUsage[] | null>;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  refresh: (force?: boolean) => Promise<void>;
  killAll: () => void;
}

interface LedgerResult {
  claude: {
    daily: ProjectUsage[];
    weekly: ProjectUsage[];
    monthly: ProjectUsage[];
  };
  codex: {
    daily: ProjectUsage[];
    weekly: ProjectUsage[];
    monthly: ProjectUsage[];
  };
}

const THROTTLE_MS = 30_000;
const WORKER_TIMEOUT_MS = 60_000;

// In dev mode, import.meta.url points to this .ts source file.
// In bundled mode, import.meta.url points to dist/cli.js and the pre-built
// dist/ledger-worker.js lives alongside it.
const _workerJs = new URL("./ledger-worker.js", import.meta.url).pathname;
const _workerTs = new URL("../lib/ledger-worker.ts", import.meta.url).pathname;
const WORKER_PATH = existsSync(_workerJs) ? _workerJs : _workerTs;

const activeProcs = new Set<{ kill(): void }>();

export function useLedgerData(): LedgerHook {
  const [claudeDaily, setClaudeDaily] = createSignal<ProjectUsage[] | null>(null);
  const [claudeWeekly, setClaudeWeekly] = createSignal<ProjectUsage[] | null>(null);
  const [claudeMonthly, setClaudeMonthly] = createSignal<ProjectUsage[] | null>(null);
  const [codexDaily, setCodexDaily] = createSignal<ProjectUsage[] | null>(null);
  const [codexWeekly, setCodexWeekly] = createSignal<ProjectUsage[] | null>(null);
  const [codexMonthly, setCodexMonthly] = createSignal<ProjectUsage[] | null>(null);

  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let lastRefresh = 0;

  async function refresh(force = false) {
    if (loading()) return;
    const now = Date.now();
    if (!force && now - lastRefresh < THROTTLE_MS) return;
    lastRefresh = now;
    setLoading(true);
    setError(null);

    try {
      const proc = Bun.spawn(["bun", "run", WORKER_PATH], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      activeProcs.add(proc);
      const timeout = setTimeout(() => {
        proc.kill();
        activeProcs.delete(proc);
      }, WORKER_TIMEOUT_MS);
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      clearTimeout(timeout);
      activeProcs.delete(proc);

      if (exitCode !== 0) {
        setError("Ledger worker exited with error");
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        setError("Ledger worker returned empty output");
        return;
      }

      const data = JSON.parse(trimmed) as LedgerResult;

      setClaudeDaily(data.claude.daily);
      setClaudeWeekly(data.claude.weekly);
      setClaudeMonthly(data.claude.monthly);
      setCodexDaily(data.codex.daily);
      setCodexWeekly(data.codex.weekly);
      setCodexMonthly(data.codex.monthly);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function killAll() {
    for (const proc of activeProcs) {
      try { proc.kill(); } catch {}
    }
    activeProcs.clear();
  }

  return {
    claudeDaily,
    claudeWeekly,
    claudeMonthly,
    codexDaily,
    codexWeekly,
    codexMonthly,
    loading,
    error,
    refresh,
    killAll,
  };
}
