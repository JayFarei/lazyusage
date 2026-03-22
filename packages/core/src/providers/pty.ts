/**
 * PTY-based usage providers wrapping collectors.
 * Port of src/providers/pty.py
 */

import { DataSource } from "../types.js";
import type { FetchResult, UsageProvider, PersistentUsageProvider, MetricsDict } from "../types.js";
import { ClaudeEphemeralCollector, ClaudePersistentCollector } from "../collectors/claude.js";
import { CodexEphemeralCollector, CodexPersistentCollector } from "../collectors/codex.js";

/** Check if metrics are genuinely missing or came entirely from fallbacks */
function isLikelyStale(metrics: MetricsDict | null): boolean {
  if (!metrics) return true;
  // Check if there are any actual metric entries (not just subscription_type)
  const metricEntries = Object.entries(metrics).filter(([key]) => key !== "subscription_type" && key !== "__parsed");
  if (metricEntries.length === 0) return true;
  // If parser flagged that no regex matched, all values are from applyFallbacks()
  if ("__parsed" in metrics && (metrics as any).__parsed === false) return true;
  return false;
}

/** Ephemeral PTY-based Claude usage provider */
export class ClaudePTYProvider implements UsageProvider {
  name = "ClaudePTYProvider";
  sourceType = DataSource.PTY;

  private _collector = new ClaudeEphemeralCollector();

  isAvailable(): boolean {
    return true;
  }

  async fetch(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;

    try {
      const metrics = await this._collector.collect();

      if (isLikelyStale(metrics)) {
        return {
          metrics,
          source: this.sourceType,
          timestamp,
          error: "Empty metrics returned (possibly stale session)",
          stale: true,
        };
      }

      return { metrics, source: this.sourceType, timestamp, error: null, stale: false };
    } catch (e) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: `PTY collection failed: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }
}

/** Persistent PTY-based Claude usage provider */
export class ClaudePersistentPTYProvider implements PersistentUsageProvider {
  name = "ClaudePersistentPTYProvider";
  sourceType = DataSource.PTY;

  private _collector = new ClaudePersistentCollector();

  isAvailable(): boolean {
    return true;
  }

  async start(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;
    try {
      const metrics = await this._collector.start();

      if (isLikelyStale(metrics)) {
        return {
          metrics,
          source: this.sourceType,
          timestamp,
          error: "Empty metrics returned (possibly stale session)",
          stale: true,
        };
      }

      return { metrics, source: this.sourceType, timestamp, error: null, stale: false };
    } catch (e) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: `PTY start failed: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }

  async refresh(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;
    try {
      const metrics = await this._collector.refresh();

      if (isLikelyStale(metrics)) {
        return {
          metrics,
          source: this.sourceType,
          timestamp,
          error: "Empty metrics returned (possibly stale session)",
          stale: true,
        };
      }

      return { metrics, source: this.sourceType, timestamp, error: null, stale: false };
    } catch (e) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: `PTY refresh failed: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }

  async stop(): Promise<void> {
    try {
      await this._collector.stop();
    } catch {
      // Best effort cleanup
    }
  }

  async fetch(): Promise<FetchResult> {
    return {
      metrics: null,
      source: this.sourceType,
      timestamp: Date.now() / 1000,
      error: "Use start() and refresh() for persistent provider",
      stale: false,
    };
  }
}

/** Ephemeral PTY-based Codex usage provider */
export class CodexPTYProvider implements UsageProvider {
  name = "CodexPTYProvider";
  sourceType = DataSource.PTY;

  private _collector = new CodexEphemeralCollector();

  isAvailable(): boolean {
    return true;
  }

  async fetch(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;
    try {
      const metrics = await this._collector.collect();

      if (isLikelyStale(metrics)) {
        return {
          metrics,
          source: this.sourceType,
          timestamp,
          error: "Empty metrics returned (possibly stale session)",
          stale: true,
        };
      }

      return { metrics, source: this.sourceType, timestamp, error: null, stale: false };
    } catch (e) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: `PTY collection failed: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }
}

/** Persistent PTY-based Codex usage provider */
export class CodexPersistentPTYProvider implements PersistentUsageProvider {
  name = "CodexPersistentPTYProvider";
  sourceType = DataSource.PTY;

  private _collector = new CodexPersistentCollector();

  isAvailable(): boolean {
    return true;
  }

  async start(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;
    try {
      const metrics = await this._collector.start();

      if (isLikelyStale(metrics)) {
        return {
          metrics,
          source: this.sourceType,
          timestamp,
          error: "Empty metrics returned (possibly stale session)",
          stale: true,
        };
      }

      return { metrics, source: this.sourceType, timestamp, error: null, stale: false };
    } catch (e) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: `PTY start failed: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }

  async refresh(): Promise<FetchResult> {
    const timestamp = Date.now() / 1000;
    try {
      const metrics = await this._collector.refresh();

      if (isLikelyStale(metrics)) {
        return {
          metrics,
          source: this.sourceType,
          timestamp,
          error: "Empty metrics returned (possibly stale session)",
          stale: true,
        };
      }

      return { metrics, source: this.sourceType, timestamp, error: null, stale: false };
    } catch (e) {
      return {
        metrics: null,
        source: this.sourceType,
        timestamp,
        error: `PTY refresh failed: ${e instanceof Error ? e.message : String(e)}`,
        stale: false,
      };
    }
  }

  async stop(): Promise<void> {
    try {
      await this._collector.stop();
    } catch {
      // Best effort cleanup
    }
  }

  async fetch(): Promise<FetchResult> {
    return {
      metrics: null,
      source: this.sourceType,
      timestamp: Date.now() / 1000,
      error: "Use start() and refresh() for persistent provider",
      stale: false,
    };
  }
}
