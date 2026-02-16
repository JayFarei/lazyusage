/**
 * Parse Claude Code JSONL session files from ~/.claude/projects/.
 *
 * Each file contains one JSON object per line. We filter for events with
 * type === "assistant" that contain message.usage token counts.
 * Subagent events (isSidechain === true) are skipped to avoid double-counting.
 */
import { homedir } from "os";
import { join } from "path";
import type { SessionTokens } from "./types.js";

interface ClaudeEvent {
  type?: string;
  isSidechain?: boolean;
  cwd?: string;
  timestamp?: string;
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
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function projectFromCwd(cwd: string): string {
  if (!cwd) return "unknown";
  const parts = cwd.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "unknown";
}

export async function parseClaudeSessions(sinceDate?: string): Promise<SessionTokens[]> {
  const claudeDir = join(homedir(), ".claude", "projects");
  const results: SessionTokens[] = [];

  const glob = new Bun.Glob("**/*.jsonl");
  let files: string[];
  try {
    files = Array.from(glob.scanSync({ cwd: claudeDir, absolute: true }));
  } catch {
    return results;
  }

  for (const filePath of files) {
    try {
      const text = await Bun.file(filePath).text();
      const lines = text.split("\n");

      for (const line of lines) {
        if (!line.trim()) continue;

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
        if (sinceDate && date < sinceDate) continue;

        const cwd = event.cwd ?? "";
        const inputTokens = (usage.input_tokens ?? 0)
          + (usage.cache_read_input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0);
        const outputTokens = usage.output_tokens ?? 0;

        results.push({
          project: projectFromCwd(cwd),
          cwd,
          service: "claude",
          date,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        });
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return results;
}
