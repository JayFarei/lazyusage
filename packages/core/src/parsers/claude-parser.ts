/**
 * Parse Claude Code JSONL session files from ~/.claude/projects/.
 *
 * Each file contains one JSON object per line. We filter for events with
 * type === "assistant" that contain message.usage token counts.
 * Subagent events (isSidechain === true) are skipped to avoid double-counting.
 *
 * Performance:
 *   - mtime pre-filter skips files not modified since sinceDate (no I/O)
 *   - parse-cache returns cached SessionTokens for unchanged files (SQLite)
 *   - only new/modified files are read from disk and parsed
 *   - changed files are parsed in parallel
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveProjectName } from "../utils/project.js";
import { evictStale, loadCacheSince, putCacheBatch } from "./parse-cache.js";
import type { SessionTokens } from "./types.js";

interface ClaudeEvent {
  type?: string;
  isSidechain?: boolean;
  cwd?: string;
  timestamp?: string;
  sessionId?: string;
  uuid?: string;
  requestId?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

function dateFromTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a single file. Returns ALL sessions with no date filter so results
 *  can be cached and reused across different sinceDate windows. */
async function parseFile(filePath: string): Promise<SessionTokens[]> {
  const isSubagent = filePath.includes("/subagents/");
  const fileResults: SessionTokens[] = [];
  try {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;

      // ASCII pre-filter: skip lines that can't be assistant events with usage
      if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;

      let event: ClaudeEvent;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event.type !== "assistant") continue;
      if (event.isSidechain === true) continue;

      const usage = event.message?.usage;
      if (!usage) continue;

      const ts = event.timestamp;
      if (!ts) continue;

      const date = dateFromTimestamp(ts);
      if (!date) continue;

      const cwd = event.cwd ?? "";
      const inputTokens = usage.input_tokens ?? 0;
      const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
      const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? 0;
      const totalTokens = inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens;

      // Build dedup key from event identity fields (sessionId:uuid:requestId)
      const dedupKey =
        event.sessionId && event.uuid && event.requestId ? `${event.sessionId}:${event.uuid}:${event.requestId}` : "";

      fileResults.push({
        project: resolveProjectName(cwd),
        cwd,
        service: "claude",
        date,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        totalTokens,
        ...(dedupKey ? { dedupKey, isSubagent } : {}),
      } as SessionTokens);
    }
  } catch {
    // Skip files that can't be read
  }
  return fileResults;
}

/**
 * Deduplicate events across files. When the same event (same sessionId:uuid:requestId)
 * appears in both a parent session file and a subagent file, prefer the subagent copy.
 * This prevents ~2x token inflation from subagent JSONL mirroring.
 */
function deduplicateEvents(sessions: SessionTokens[]): SessionTokens[] {
  const keyed = new Map<string, SessionTokens>();
  const unkeyedResults: SessionTokens[] = [];

  for (const s of sessions) {
    const parsed = s as SessionTokens & { dedupKey?: string; isSubagent?: boolean };
    if (!parsed.dedupKey) {
      unkeyedResults.push(s);
      continue;
    }
    const existing = keyed.get(parsed.dedupKey) as (SessionTokens & { isSubagent?: boolean }) | undefined;
    if (!existing) {
      keyed.set(parsed.dedupKey, s);
    } else {
      // Prefer subagent over parent
      if (parsed.isSubagent && !existing.isSubagent) {
        keyed.set(parsed.dedupKey, s);
      }
    }
  }

  // Strip internal dedup fields before returning
  const dedupedResults = [...keyed.values(), ...unkeyedResults];
  for (const s of dedupedResults) {
    const ext = s as SessionTokens & { dedupKey?: string; isSubagent?: boolean };
    delete ext.dedupKey;
    delete ext.isSubagent;
  }
  return dedupedResults;
}

export async function parseClaudeSessions(sinceDate?: string, baseDir?: string): Promise<SessionTokens[]> {
  const claudeDir = baseDir ?? join(homedir(), ".claude", "projects");

  const glob = new Bun.Glob("**/*.jsonl");
  let allFiles: string[];
  try {
    allFiles = Array.from(glob.scanSync({ cwd: claudeDir, absolute: true }));
  } catch {
    return [];
  }

  const sinceDateMs = sinceDate ? new Date(sinceDate).getTime() : 0;

  // Load all relevant cache entries in one bulk SELECT
  const cache = loadCacheSince(sinceDateMs);

  const results: SessionTokens[] = [];
  const toReparse: string[] = [];
  const toReparseMtimes = new Map<string, number>();

  for (const filePath of allFiles) {
    let mtime: number;
    try {
      mtime = statSync(filePath).mtimeMs;
    } catch {
      continue;
    }

    // mtime pre-filter: file cannot have any events in the window
    if (sinceDateMs && mtime < sinceDateMs) continue;

    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === mtime) {
      // Cache hit: filter sessions to the requested window
      for (const s of cached.sessions) {
        if (!sinceDate || s.date >= sinceDate) results.push(s);
      }
    } else {
      // Cache miss: must re-parse
      toReparse.push(filePath);
      toReparseMtimes.set(filePath, mtime);
    }
  }

  // Parse all cache-miss files in parallel
  if (toReparse.length > 0) {
    const parsed = await Promise.all(toReparse.map(parseFile));
    const newEntries: Array<{ filePath: string; mtimeMs: number; sessions: SessionTokens[] }> = [];

    for (let i = 0; i < toReparse.length; i++) {
      const filePath = toReparse[i];
      const sessions = parsed[i];
      const mtimeMs = toReparseMtimes.get(filePath);
      if (mtimeMs === undefined) {
        continue;
      }

      newEntries.push({ filePath, mtimeMs, sessions });
      for (const s of sessions) {
        if (!sinceDate || s.date >= sinceDate) results.push(s);
      }
    }

    putCacheBatch(newEntries);
  }

  // Evict entries for files that no longer exist on disk + enforce max entries cap
  evictStale(allFiles);

  // Cross-file deduplication: remove duplicate events that appear in both
  // parent and subagent session files (prevents ~2x token inflation)
  return deduplicateEvents(results);
}
