/**
 * Session-file-based Codex usage provider.
 * Reads rate_limits from the latest token_count event in Codex JSONL session files.
 * This is the most reliable source since Codex embeds rate limit data in every session.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { buildCodexMetrics, type CodexRateWindow } from "../parsers/codex-rate-limits.js";
import type { FetchResult, MetricsDict, UsageProvider } from "../types.js";
import { DataSource } from "../types.js";

interface RateLimitWindow {
  used_percent?: number | null;
  window_minutes?: number | null;
  resets_at?: number | null;
}

interface RateLimits {
  /** "codex" for the account-wide limit; per-model limits (e.g. Codex Spark) use other ids. */
  limit_id?: string | null;
  plan_type?: string | null;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
}

/** Account-wide limit events only; legacy events without a limit_id are accepted. */
function isAccountLimit(rl: RateLimits): boolean {
  return rl.limit_id === null || rl.limit_id === undefined || rl.limit_id === "codex";
}

interface TokenCountEvent {
  type: string;
  payload?: {
    type?: string;
    rate_limits?: RateLimits;
  };
}

export class CodexSessionProvider implements UsageProvider {
  name = "CodexSessionProvider";
  sourceType = DataSource.API; // Treat as API-quality data

  private _sessionsDir: string;
  private _archivedDir: string;

  constructor(baseDir?: string) {
    const codexHome = baseDir ?? join(homedir(), ".codex");
    this._sessionsDir = join(codexHome, "sessions");
    this._archivedDir = join(codexHome, "archived_sessions");
  }

  isAvailable(): boolean {
    try {
      const glob = new Bun.Glob("**/*.jsonl");
      const files = Array.from(glob.scanSync({ cwd: this._sessionsDir, absolute: true }));
      return files.length > 0;
    } catch {
      return false;
    }
  }

  async fetch(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;

    try {
      const rateLimits = await this._findLatestRateLimits();
      if (!rateLimits) {
        return {
          metrics: null,
          source: this.sourceType,
          timestamp,
          error: "No rate_limits found in recent session files",
          stale: false,
        };
      }

      const metrics = this._parseRateLimits(rateLimits);
      return {
        metrics,
        source: this.sourceType,
        timestamp,
        error: null,
        stale: false,
      };
    } catch (e) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: `Session file read failed: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }

  private async _findLatestRateLimits(): Promise<RateLimits | null> {
    // Collect files from both sessions and archived_sessions
    const allFiles: Array<{ path: string; mtimeMs: number }> = [];

    for (const dir of [this._sessionsDir, this._archivedDir]) {
      try {
        const glob = new Bun.Glob("**/*.jsonl");
        for (const file of glob.scanSync({ cwd: dir, absolute: true })) {
          try {
            const stat = Bun.file(file);
            // Use lastModified as a proxy for recency
            allFiles.push({ path: file, mtimeMs: stat.lastModified });
          } catch {}
        }
      } catch {}
    }

    if (allFiles.length === 0) return null;

    // Sort by mtime descending, check most recent files first
    allFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

    // Only check the 5 most recent files to avoid scanning everything
    const candidates = allFiles.slice(0, 5);

    for (const { path } of candidates) {
      const rateLimits = await this._extractRateLimitsFromFile(path);
      if (rateLimits) return rateLimits;
    }

    return null;
  }

  private async _extractRateLimitsFromFile(filePath: string): Promise<RateLimits | null> {
    try {
      const text = await Bun.file(filePath).text();
      const lines = text.split("\n").filter((l) => l.trim());

      // Scan from the end to find the last token_count event with rate_limits
      for (let i = lines.length - 1; i >= 0; i--) {
        let event: TokenCountEvent;
        try {
          event = JSON.parse(lines[i]);
        } catch {
          continue;
        }

        if (
          event.type === "event_msg" &&
          event.payload?.type === "token_count" &&
          event.payload.rate_limits != null &&
          event.payload.rate_limits.primary != null &&
          isAccountLimit(event.payload.rate_limits)
        ) {
          return event.payload.rate_limits;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private _parseRateLimits(rl: RateLimits): MetricsDict {
    const toWindow = (w: RateLimitWindow | null | undefined): CodexRateWindow | null =>
      w
        ? {
            usedPercent: w.used_percent,
            windowSeconds: w.window_minutes === null || w.window_minutes === undefined ? null : w.window_minutes * 60,
            resetAtUnix: w.resets_at,
          }
        : null;

    return buildCodexMetrics(rl.plan_type, [toWindow(rl.primary), toWindow(rl.secondary)]);
  }
}
