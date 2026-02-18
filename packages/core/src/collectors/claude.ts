/**
 * Claude CLI collectors.
 * Port of src/collectors/claude.py
 */

import type { MetricsDict, EphemeralCollector, PersistentCollector } from "../types.js";
import { EphemeralSession, PersistentSession } from "../utils/tmux.js";
import { parseClaudeOutput } from "../parsers/claude.js";

/** Ephemeral collector for Claude CLI (single-shot usage) */
export class ClaudeEphemeralCollector implements EphemeralCollector {
  async collect(): Promise<MetricsDict> {
    const sessionName = `claude-usage-${process.pid}`;
    const session = new EphemeralSession(sessionName, "claude");

    try {
      await session.enter();

      // Wait for landing page
      await Bun.sleep(1000);

      // Capture landing page for subscription
      const landingOutput = await session.captureOutput();

      // Send /usage command character-by-character
      await session.sendKeys("/usage", 200, false);

      // Send Enter
      await session.sendKeys("Enter", 0, true);

      // Poll until usage output appears
      const usageOutput = await session.waitForContent("% used", 8000);

      // Combine landing + usage for full parsing
      const combinedOutput = landingOutput + "\n" + usageOutput;

      return parseClaudeOutput(combinedOutput);
    } finally {
      session.cleanup();
    }
  }
}

/** Persistent collector for Claude CLI (live dashboard with session reuse) */
export class ClaudePersistentCollector implements PersistentCollector {
  private sessionName: string;
  private session: PersistentSession;
  private landingOutput: string | null = null;
  private _lastGood: MetricsDict | null = null;

  constructor() {
    this.sessionName = `claude-live-${process.pid}`;
    this.session = new PersistentSession(this.sessionName, "claude");
  }

  async start(): Promise<MetricsDict> {
    // Create session and wait for prompt
    await this.session.windup();

    // Capture landing page (has subscription info)
    await Bun.sleep(1000);
    this.landingOutput = await this.session.captureOutput();

    // Execute /usage command
    await this.session.sendKeys("/usage", 200, false);
    await this.session.sendKeys("Enter", 0, true);

    // Poll until usage output appears
    const usageOutput = await this.session.waitForContent("% used", 8000);

    const combinedOutput = (this.landingOutput ?? "") + "\n" + usageOutput;
    const metrics = parseClaudeOutput(combinedOutput);

    if (this._hasRealData(metrics)) {
      this._lastGood = metrics;
    }

    return metrics;
  }

  private _hasRealData(metrics: MetricsDict): boolean {
    for (const key of ["session", "week_all", "week_sonnet"]) {
      const entry = metrics[key];
      if (entry && typeof entry === "object" && "used_pct" in entry && entry.used_pct > 0) {
        return true;
      }
    }
    return false;
  }

  async refresh(): Promise<MetricsDict> {
    // Press ESC to return to prompt
    await this.session.sendKeys("Escape", 0, true);
    await Bun.sleep(500);

    // Execute /usage command
    await this.session.sendKeys("/usage", 200, false);
    await this.session.sendKeys("Enter", 0, true);

    // Poll until usage output appears
    const usageOutput = await this.session.waitForContent("% used", 8000);

    const combinedOutput = (this.landingOutput ?? "") + "\n" + usageOutput;
    const metrics = parseClaudeOutput(combinedOutput);

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
