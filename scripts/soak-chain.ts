#!/usr/bin/env bun

/**
 * Headless soak test for the usage fetch chain.
 * Runs PersistentFallbackChain.start() + .refresh() in a loop for N minutes,
 * logging every chain decision to a JSONL file for post-hoc analysis.
 *
 * Usage:
 *   bun scripts/soak-chain.ts                     # 5 min, 30s interval
 *   bun scripts/soak-chain.ts --duration 10       # 10 min
 *   bun scripts/soak-chain.ts --interval 15       # 15s refresh interval
 *   bun scripts/soak-chain.ts --service claude    # claude only
 *
 * Output:
 *   .soak-chain-<timestamp>.jsonl   — structured events (one JSON per line)
 *   stdout                          — human-readable summary
 */

import { appendFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  type ChainDiagnosticEvent,
  ClaudeAPIProvider,
  CodexAPIProvider,
  createClaudeChain,
  createCodexChain,
  type FetchResult,
  type MetricData,
  type PersistentFallbackChain,
  setChainDiagnosticListener,
} from "../packages/core/src/index.js";

// -- CLI args --

const { values: args } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    duration: { type: "string", default: "5" },
    interval: { type: "string", default: "30" },
    service: { type: "string", default: "all" },
    output: { type: "string" },
  },
});

const DURATION_MIN = parseInt(args.duration ?? "5", 10);
const INTERVAL_SEC = parseInt(args.interval ?? "30", 10);
const SERVICE_FILTER = args.service as "claude" | "codex" | "all";
const DURATION_MS = DURATION_MIN * 60_000;
const INTERVAL_MS = INTERVAL_SEC * 1000;

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logFile = args.output ?? `.soak-chain-${timestamp}.jsonl`;

// -- Logging --

let eventCount = 0;

function logEvent(event: Record<string, unknown>): void {
  appendFileSync(logFile, `${JSON.stringify(event)}\n`);
  eventCount++;
}

function logLine(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${msg}`);
}

// -- Main --

async function run() {
  writeFileSync(logFile, ""); // truncate

  logLine(`Soak test: ${DURATION_MIN}min, ${INTERVAL_SEC}s interval, service=${SERVICE_FILTER}`);
  logLine(`Log file: ${logFile}`);
  logLine("");

  // Wire up diagnostic listener
  setChainDiagnosticListener((event: ChainDiagnosticEvent) => {
    logEvent({ type: "chain", ...event });
  });

  // Create chains
  const chains: Array<{ name: string; chain: PersistentFallbackChain }> = [];

  if (SERVICE_FILTER === "all" || SERVICE_FILTER === "claude") {
    const chain = createClaudeChain(true) as PersistentFallbackChain;
    chains.push({ name: "claude", chain });
  }
  if (SERVICE_FILTER === "all" || SERVICE_FILTER === "codex") {
    const chain = createCodexChain(true) as PersistentFallbackChain;
    chains.push({ name: "codex", chain });
  }

  // Stats tracking
  const stats: Record<string, { total: number; bySource: Record<string, number>; errors: number; stale: number }> = {};
  for (const { name } of chains) {
    stats[name] = { total: 0, bySource: {}, errors: 0, stale: 0 };
  }

  // Start phase
  logLine("--- START phase ---");
  for (const { name, chain } of chains) {
    logEvent({ type: "lifecycle", service: name, action: "start", ts: new Date().toISOString() });
    const result = await chain.start();
    recordResult(name, result, stats);
    printResult(name, result, "start");
  }

  // Refresh loop
  const totalCycles = Math.floor(DURATION_MS / INTERVAL_MS);
  logLine(`\n--- REFRESH phase (${totalCycles} cycles) ---`);

  const startedAt = Date.now();

  for (let i = 1; i <= totalCycles; i++) {
    await Bun.sleep(INTERVAL_MS);

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const elapsedMin = Math.floor(elapsed / 60);
    const elapsedSec = elapsed % 60;

    for (const { name, chain } of chains) {
      logEvent({
        type: "lifecycle",
        service: name,
        action: "refresh",
        cycle: i,
        elapsed_s: elapsed,
        ts: new Date().toISOString(),
        claude_rate_limited: ClaudeAPIProvider.isRateLimited(),
        codex_rate_limited: CodexAPIProvider.isRateLimited(),
      });

      const result = await chain.refresh();
      recordResult(name, result, stats);
      printResult(name, result, `${elapsedMin}m${String(elapsedSec).padStart(2, "0")}s  #${i}`);
    }
  }

  // Stop
  logLine("\n--- STOP phase ---");
  for (const { name, chain } of chains) {
    await chain.stop();
    logEvent({ type: "lifecycle", service: name, action: "stop", ts: new Date().toISOString() });
  }

  // Cleanup
  setChainDiagnosticListener(null);

  // Summary
  logLine("\n========== SUMMARY ==========");
  for (const [name, s] of Object.entries(stats)) {
    logLine(`${name}: ${s.total} fetches, ${s.errors} errors, ${s.stale} stale`);
    for (const [source, count] of Object.entries(s.bySource).sort((a, b) => b[1] - a[1])) {
      const pct = ((count / s.total) * 100).toFixed(1);
      logLine(`  ${source}: ${count} (${pct}%)`);
    }
  }

  logEvent({ type: "summary", stats, ts: new Date().toISOString() });
  logLine(`\n${eventCount} diagnostic events written to ${logFile}`);
  logLine(`Analyze with: cat ${logFile} | bun -e 'for await (const l of console) console.log(JSON.parse(l))'`);
  logLine(`Or: grep '"step":"reuse-last-result"' ${logFile} | wc -l`);
}

function recordResult(
  name: string,
  result: FetchResult,
  stats: Record<string, { total: number; bySource: Record<string, number>; errors: number; stale: number }>,
) {
  const s = stats[name];
  s.total++;
  const src = result.source;
  s.bySource[src] = (s.bySource[src] ?? 0) + 1;
  if (result.error) s.errors++;
  if (result.stale) s.stale++;

  // Extract used_pct for the session window
  const sessionKey = name === "claude" ? "session" : "5h";
  const sessionData = result.metrics?.[sessionKey] as MetricData | undefined;

  logEvent({
    type: "result",
    service: name,
    source: src,
    stale: result.stale,
    error: result.error,
    session_pct: sessionData?.used_pct ?? null,
    ts: new Date().toISOString(),
  });
}

function printResult(name: string, result: FetchResult, label: string) {
  const src = result.source.toUpperCase();
  const stale = result.stale ? " (stale)" : "";
  const err = result.error ? ` ERR: ${result.error.slice(0, 60)}` : "";
  const sessionKey = name === "claude" ? "session" : "5h";
  const sessionData = result.metrics?.[sessionKey] as MetricData | undefined;
  const pct = sessionData?.used_pct != null ? ` ${sessionData.used_pct}%` : "";
  logLine(`  ${name.padEnd(6)} [${label}] → ${src}${stale}${pct}${err}`);
}

run().catch((e) => {
  console.error("Soak test failed:", e);
  process.exit(1);
});
