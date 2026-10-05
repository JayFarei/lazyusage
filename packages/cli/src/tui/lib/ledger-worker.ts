#!/usr/bin/env bun
import type { ServiceName } from "lazyusage-core";
/**
 * Standalone worker script for loading per-project usage ledger data.
 * Replaces ccusage-worker.ts and codex-ccusage.ts.
 *
 * Parses session files directly from:
 *   ~/.claude/projects/  (Claude Code sessions)
 *   ~/.codex/sessions/   (Codex CLI sessions)
 *   ~/.grok/sessions/    (Grok Build sessions)
 *
 * Outputs JSON to stdout, one entry per service:
 *   { claude: { daily, weekly, monthly }, codex: { ... }, grok: { ... } }
 *
 * Accepts optional --since YYYY-MM-DD flag to limit parsing window (default: 28 days ago).
 */
import { aggregateDaily, aggregateMonthly, aggregateWeekly } from "lazyusage-core/parsers/aggregator";
import { parseClaudeSessions } from "lazyusage-core/parsers/claude-parser";
import { parseCodexSessions } from "lazyusage-core/parsers/codex-parser";
import { parseGrokSessions } from "lazyusage-core/parsers/grok-parser";
import type { SessionTokens } from "lazyusage-core/parsers/types";

const PARSERS: Record<ServiceName, (since: string) => Promise<SessionTokens[]>> = {
  claude: parseClaudeSessions,
  codex: parseCodexSessions,
  grok: parseGrokSessions,
};

function defaultSince(): string {
  const d = new Date();
  d.setDate(d.getDate() - 28);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const sinceIdx = process.argv.indexOf("--since");
const since = sinceIdx !== -1 && process.argv[sinceIdx + 1] ? process.argv[sinceIdx + 1] : defaultSince();

try {
  const entries = await Promise.all(
    Object.entries(PARSERS).map(async ([service, parse]) => {
      const sessions = await parse(since);
      return [
        service,
        { daily: aggregateDaily(sessions), weekly: aggregateWeekly(sessions), monthly: aggregateMonthly(sessions) },
      ] as const;
    }),
  );

  process.stdout.write(JSON.stringify(Object.fromEntries(entries)));
} catch (err) {
  process.stderr.write(`ledger worker error: ${err}\n`);
  process.exit(1);
}
