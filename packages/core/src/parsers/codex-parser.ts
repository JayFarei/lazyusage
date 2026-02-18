/**
 * Parse Codex CLI JSONL session files from ~/.codex/sessions/.
 *
 * Each file has:
 * - Line 1: session_meta with cwd and timestamp
 * - Subsequent lines: event_msg entries, some with payload.type === "token_count"
 * - We use the last token_count event with non-null info for cumulative totals.
 */
import { homedir } from "os";
import { join } from "path";
import type { SessionTokens } from "./types.js";
import { resolveProjectName } from "../utils/project.js";

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

export async function parseCodexSessions(sinceDate?: string, baseDir?: string): Promise<SessionTokens[]> {
  const codexDir = baseDir ?? join(homedir(), ".codex", "sessions");
  const results: SessionTokens[] = [];

  const glob = new Bun.Glob("**/*.jsonl");
  let files: string[];
  try {
    files = Array.from(glob.scanSync({ cwd: codexDir, absolute: true }));
  } catch {
    return results;
  }

  for (const filePath of files) {
    try {
      const text = await Bun.file(filePath).text();
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length === 0) continue;

      // First line: session_meta
      let meta: SessionMeta;
      try {
        meta = JSON.parse(lines[0]);
      } catch {
        continue;
      }

      if (meta.type !== "session_meta") continue;

      const cwd = meta.payload?.cwd ?? "";
      const ts = meta.payload?.timestamp ?? meta.timestamp ?? "";
      const date = dateFromTimestamp(ts);
      if (!date) continue;
      if (sinceDate && date < sinceDate) continue;

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

      if (!lastUsage) continue;

      const inputTokens = (lastUsage.input_tokens ?? 0)
        + (lastUsage.cached_input_tokens ?? 0);
      const outputTokens = (lastUsage.output_tokens ?? 0)
        + (lastUsage.reasoning_output_tokens ?? 0);

      results.push({
        project: resolveProjectName(cwd),
        cwd,
        service: "codex",
        date,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      });
    } catch {
      // Skip files that can't be read
    }
  }

  return results;
}
