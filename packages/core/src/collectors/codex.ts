/**
 * Codex CLI collectors.
 * Port of src/collectors/codex.py
 */

import type { MetricsDict, EphemeralCollector, PersistentCollector } from "../types.js";
import { EphemeralSession, PersistentSession } from "../utils/tmux.js";
import { parseCodexOutput } from "../parsers/codex.js";

/** Ephemeral collector for Codex CLI (single-shot usage) */
export class CodexEphemeralCollector implements EphemeralCollector {
  async collect(): Promise<MetricsDict> {
    const sessionName = `codex-usage-${process.pid}`;
    const session = new EphemeralSession(sessionName, "codex");

    try {
      await session.enter();

      // Send /status command character-by-character
      await session.sendKeys("/status", 200, false);

      // Send Enter
      await session.sendKeys("Enter", 0, true);

      // Poll until status output appears
      const output = await session.waitForContent("limit:", 8000);

      return parseCodexOutput(output);
    } finally {
      await session.cleanup();
    }
  }
}

/** Persistent collector for Codex CLI (live dashboard with session reuse) */
export class CodexPersistentCollector implements PersistentCollector {
  private sessionName: string;
  private session: PersistentSession;
  private _lastGood: MetricsDict | null = null;

  constructor() {
    this.sessionName = `codex-live-${process.pid}`;
    this.session = new PersistentSession(this.sessionName, "codex");
  }

  async start(): Promise<MetricsDict> {
    // Create session and wait for prompt
    await this.session.windup();

    // Execute /status command
    await this.session.sendKeys("/status", 200, false);
    await this.session.sendKeys("Enter", 0, true);

    // Poll until status output appears
    const output = await this.session.waitForContent("limit:", 8000);

    const metrics = parseCodexOutput(output);
    if (this._hasRealData(metrics)) {
      this._lastGood = metrics;
    }

    return metrics;
  }

  private _hasRealData(metrics: MetricsDict): boolean {
    for (const key of ["5h", "weekly"]) {
      const entry = metrics[key];
      if (entry && typeof entry === "object" && "used_pct" in entry && typeof entry.used_pct === "number") {
        return true;
      }
    }
    return false;
  }

  async refresh(): Promise<MetricsDict> {
    // Execute /status command
    await this.session.sendKeys("/status", 200, false);
    await this.session.sendKeys("Enter", 0, true);

    // Poll until status output appears
    const output = await this.session.waitForContent("limit:", 8000);

    const metrics = parseCodexOutput(output);
    if (this._hasRealData(metrics)) {
      this._lastGood = metrics;
      return metrics;
    }

    // If capture failed, return last known good metrics
    if (this._lastGood !== null) {
      return this._lastGood;
    }

    return metrics;
  }

  async stop(): Promise<void> {
    await this.session.winddown();
  }
}
