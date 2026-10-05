/**
 * Hook for loading per-project usage ledger data.
 * Replaces useCcusageData.ts.
 *
 * Spawns a single ledger-worker subprocess that parses session files
 * from ~/.claude/projects/, ~/.codex/sessions/ and ~/.grok/sessions/ directly.
 *
 * 30s throttled refresh, independent of rate-limit polling.
 */

import { existsSync } from "node:fs";
import type { ServiceName } from "lazyusage-core";
import type { ProjectUsage } from "lazyusage-core/parsers/types";
import { type Accessor, createSignal } from "solid-js";

export interface ServiceLedger {
  daily: ProjectUsage[];
  weekly: ProjectUsage[];
  monthly: ProjectUsage[];
}

export interface LedgerHook {
  /** Ledger for a service, or null before the first load (or when the worker omitted it) */
  ledgerFor: (service: ServiceName) => ServiceLedger | null;
  loading: Accessor<boolean>;
  error: Accessor<string | null>;
  refresh: (force?: boolean) => Promise<void>;
  killAll: () => void;
}

type LedgerResult = Partial<Record<ServiceName, ServiceLedger>>;

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
  const [ledgers, setLedgers] = createSignal<LedgerResult>({});

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
        const stderrText = await new Response(proc.stderr).text();
        const detail = stderrText.trim();
        setError(detail ? `Ledger worker error: ${detail}` : "Ledger worker exited with error");
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        setError("Ledger worker returned empty output");
        return;
      }

      setLedgers(JSON.parse(trimmed) as LedgerResult);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function killAll() {
    for (const proc of activeProcs) {
      try {
        proc.kill();
      } catch {}
    }
    activeProcs.clear();
  }

  return {
    ledgerFor: (service) => ledgers()[service] ?? null,
    loading,
    error,
    refresh,
    killAll,
  };
}
