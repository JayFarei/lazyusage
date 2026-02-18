#!/usr/bin/env bun
/**
 * Standalone worker script for loading per-project usage ledger data.
 * Replaces ccusage-worker.ts and codex-ccusage.ts.
 *
 * Parses JSONL files directly from:
 *   ~/.claude/projects/  (Claude Code sessions)
 *   ~/.codex/sessions/   (Codex CLI sessions)
 *
 * Outputs JSON to stdout:
 *   { claude: { daily, weekly, monthly }, codex: { daily, weekly, monthly } }
 *
 * Accepts optional --since YYYY-MM-DD flag to limit parsing window (default: 28 days ago).
 */
import { parseClaudeSessions } from "@usage-tui/core/parsers/claude-parser";
import { parseCodexSessions } from "@usage-tui/core/parsers/codex-parser";
import { aggregateDaily, aggregateWeekly, aggregateMonthly } from "@usage-tui/core/parsers/aggregator";

function defaultSince(): string {
  const d = new Date();
  d.setDate(d.getDate() - 28);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const sinceIdx = process.argv.indexOf("--since");
const since = sinceIdx !== -1 && process.argv[sinceIdx + 1]
  ? process.argv[sinceIdx + 1]
  : defaultSince();

try {
  const [claudeSessions, codexSessions] = await Promise.all([
    parseClaudeSessions(since),
    parseCodexSessions(since),
  ]);

  const result = {
    claude: {
      daily: aggregateDaily(claudeSessions),
      weekly: aggregateWeekly(claudeSessions),
      monthly: aggregateMonthly(claudeSessions),
    },
    codex: {
      daily: aggregateDaily(codexSessions),
      weekly: aggregateWeekly(codexSessions),
      monthly: aggregateMonthly(codexSessions),
    },
  };

  process.stdout.write(JSON.stringify(result));
} catch (err) {
  process.stderr.write(`ledger worker error: ${err}\n`);
  process.exit(1);
}
