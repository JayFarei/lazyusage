/**
 * Parse Grok Build session usage from $GROK_HOME/sessions/.
 *
 * Layout: sessions/<url-encoded cwd>/<session id>/usage.json, holding session
 * totals plus a `turns` array with per-turn token counts and `endedAt`.
 * Turns are bucketed by the local date they ended, so a session spanning
 * midnight is split across days. Grok's `inputTokens` includes cache reads.
 *
 * usage.json is small (one per session), so unlike the JSONL parsers this
 * does not use the parse cache.
 */

import { join } from "node:path";
import { grokHome } from "../providers/credentials.js";
import { resolveProjectName } from "../utils/project.js";
import type { SessionTokens } from "./types.js";

interface GrokTurnUsage {
  endedAt?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cacheCreationTokens?: number;
}

interface GrokUsageFile {
  updatedAt?: string;
  turns?: GrokTurnUsage[];
}

function localDate(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function decodeCwd(dirName: string): string {
  try {
    return decodeURIComponent(dirName);
  } catch {
    return dirName;
  }
}

/** Parse one usage.json into one SessionTokens entry per local date with activity. */
async function parseUsageFile(filePath: string, cwd: string): Promise<SessionTokens[]> {
  let data: GrokUsageFile;
  try {
    data = (await Bun.file(filePath).json()) as GrokUsageFile;
  } catch {
    return [];
  }
  if (!Array.isArray(data.turns)) return [];

  const project = resolveProjectName(cwd);
  const byDate = new Map<string, SessionTokens>();

  for (const turn of data.turns) {
    const date = localDate(turn.endedAt ?? data.updatedAt ?? "");
    if (!date) continue;

    const cacheRead = num(turn.cachedReadTokens);
    const cacheCreation = num(turn.cacheCreationTokens);
    const fresh = Math.max(0, num(turn.inputTokens) - cacheRead);
    const output = num(turn.outputTokens);

    let entry = byDate.get(date);
    if (!entry) {
      entry = {
        project,
        cwd,
        service: "grok",
        date,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
      };
      byDate.set(date, entry);
    }
    entry.inputTokens += fresh;
    entry.outputTokens += output;
    entry.cacheReadTokens += cacheRead;
    entry.cacheCreationTokens += cacheCreation;
    entry.totalTokens += fresh + output + cacheRead + cacheCreation;
  }

  return [...byDate.values()];
}

/**
 * Parse all Grok sessions with activity on or after `sinceDate` (YYYY-MM-DD).
 * @param baseDir sessions directory override (tests); defaults to $GROK_HOME/sessions
 */
export async function parseGrokSessions(sinceDate?: string, baseDir?: string): Promise<SessionTokens[]> {
  const sessionsDir = baseDir ?? join(grokHome(), "sessions");
  const glob = new Bun.Glob("*/*/usage.json");

  let files: string[];
  try {
    files = Array.from(glob.scanSync({ cwd: sessionsDir }));
  } catch {
    return [];
  }

  const parsed = await Promise.all(
    files.map((relative) => {
      const cwd = decodeCwd(relative.split("/")[0] ?? "");
      return parseUsageFile(join(sessionsDir, relative), cwd);
    }),
  );

  const sessions = parsed.flat();
  return sinceDate ? sessions.filter((s) => s.date >= sinceDate) : sessions;
}
