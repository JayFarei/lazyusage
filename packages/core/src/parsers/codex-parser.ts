/**
 * Parse Codex CLI JSONL session files from ~/.codex/sessions/.
 *
 * Each file has:
 * - Line 1: session_meta with cwd and timestamp
 * - Subsequent lines: event_msg entries, some with payload.type === "token_count"
 * - We use the last token_count event with non-null info for cumulative totals.
 *
 * Performance: same mtime pre-filter + parse-cache strategy as claude-parser.
 */
import { homedir } from "os";
import { join } from "path";
import { statSync } from "fs";
import type { SessionTokens } from "./types.js";
import { resolveProjectName } from "../utils/project.js";
import { loadCacheSince, putCacheBatch, evictOlderThan } from "./parse-cache.js";

interface SessionMeta {
  type?: string;
  timestamp?: string;
  payload?: {
    cwd?: string;
    timestamp?: string;
  };
}

interface TokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface EventMsg {
  type?: string;
  payload?: {
    type?: string;
    info?: {
      total_token_usage?: TokenUsage;
    } | null;
  };
}

function dateFromTimestamp(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a single Codex session file. Returns a single-element array (or empty). */
async function parseFile(filePath: string): Promise<SessionTokens[]> {
  try {
    const text = await Bun.file(filePath).text();
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return [];

    let meta: SessionMeta;
    try {
      meta = JSON.parse(lines[0]);
    } catch {
      return [];
    }

    if (meta.type !== "session_meta") return [];

    const cwd = meta.payload?.cwd ?? "";
    const ts = meta.payload?.timestamp ?? meta.timestamp ?? "";
    const date = dateFromTimestamp(ts);
    if (!date) return [];

    // Find the last token_count event with non-null info
    let lastUsage: TokenUsage | null = null;
    for (let i = lines.length - 1; i >= 1; i--) {
      let event: EventMsg;
      try {
        event = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (
        event.type === "event_msg" &&
        event.payload?.type === "token_count" &&
        event.payload.info != null &&
        event.payload.info.total_token_usage != null
      ) {
        lastUsage = event.payload.info.total_token_usage;
        break;
      }
    }

    if (!lastUsage) return [];

    const inputTokens =
      (lastUsage.input_tokens ?? 0) + (lastUsage.cached_input_tokens ?? 0);
    const outputTokens =
      (lastUsage.output_tokens ?? 0) + (lastUsage.reasoning_output_tokens ?? 0);

    return [
      {
        project: resolveProjectName(cwd),
        cwd,
        service: "codex",
        date,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: inputTokens + outputTokens,
      },
    ];
  } catch {
    return [];
  }
}

export async function parseCodexSessions(
  sinceDate?: string,
  baseDir?: string
): Promise<SessionTokens[]> {
  const codexDir = baseDir ?? join(homedir(), ".codex", "sessions");

  const glob = new Bun.Glob("**/*.jsonl");
  let allFiles: string[];
  try {
    allFiles = Array.from(glob.scanSync({ cwd: codexDir, absolute: true }));
  } catch {
    return [];
  }

  const sinceDateMs = sinceDate ? new Date(sinceDate).getTime() : 0;
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

    if (sinceDateMs && mtime < sinceDateMs) continue;

    const cached = cache.get(filePath);
    if (cached && cached.mtimeMs === mtime) {
      for (const s of cached.sessions) {
        if (!sinceDate || s.date >= sinceDate) results.push(s);
      }
    } else {
      toReparse.push(filePath);
      toReparseMtimes.set(filePath, mtime);
    }
  }

  if (toReparse.length > 0) {
    const parsed = await Promise.all(toReparse.map(parseFile));
    const newEntries: Array<{ filePath: string; mtimeMs: number; sessions: SessionTokens[] }> = [];

    for (let i = 0; i < toReparse.length; i++) {
      const filePath = toReparse[i];
      const sessions = parsed[i];
      const mtimeMs = toReparseMtimes.get(filePath)!;
      newEntries.push({ filePath, mtimeMs, sessions });
      for (const s of sessions) {
        if (!sinceDate || s.date >= sinceDate) results.push(s);
      }
    }

    putCacheBatch(newEntries);
  }

  if (sinceDateMs) evictOlderThan(sinceDateMs);

  return results;
}
