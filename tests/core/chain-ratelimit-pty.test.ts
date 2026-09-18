/**
 * PersistentFallbackChain must not drive the PTY while the service's API is
 * rate-limited: both CLIs' status screens call the same usage endpoint, so
 * each PTY refresh would extend the block.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { ClaudeAPIProvider } from "../../packages/core/src/providers/api-claude.js";
import { CodexAPIProvider } from "../../packages/core/src/providers/api-codex.js";
import { PersistentFallbackChain } from "../../packages/core/src/providers/chain.js";
import type { FetchResult, PersistentUsageProvider, UsageProvider } from "../../packages/core/src/types.js";
import { DataSource } from "../../packages/core/src/types.js";

type RateLimitStatics = { _rateLimitedUntil: number };

function setRateLimit(provider: typeof ClaudeAPIProvider | typeof CodexAPIProvider, until: number): void {
  (provider as unknown as RateLimitStatics)._rateLimitedUntil = until;
}

class FailingProvider implements UsageProvider {
  name = "FailingAPI";
  sourceType = DataSource.API;
  isAvailable(): boolean {
    return true;
  }
  async fetch(): Promise<FetchResult> {
    return { metrics: null, source: this.sourceType, timestamp: Date.now() / 1000, error: "429", stale: false };
  }
}

class CountingPTY implements PersistentUsageProvider {
  name = "MockPTY";
  sourceType = DataSource.PTY;
  startCallCount = 0;
  refreshCallCount = 0;
  isAvailable(): boolean {
    return true;
  }
  private ok(): FetchResult {
    return {
      metrics: { subscription_type: "max", session: { used_pct: 1, remaining_pct: 99, resets: "1h" } },
      source: DataSource.PTY,
      timestamp: Date.now() / 1000,
      error: null,
      stale: false,
    };
  }
  async fetch(): Promise<FetchResult> {
    return this.ok();
  }
  async start(): Promise<FetchResult> {
    this.startCallCount++;
    return this.ok();
  }
  async refresh(): Promise<FetchResult> {
    this.refreshCallCount++;
    return this.ok();
  }
  async stop(): Promise<void> {}
}

afterEach(() => {
  setRateLimit(ClaudeAPIProvider, 0);
  setRateLimit(CodexAPIProvider, 0);
});

describe("PersistentFallbackChain - PTY skipped while API is rate-limited", () => {
  test("claude: start and refresh never touch the PTY during a Claude API rate limit", async () => {
    setRateLimit(ClaudeAPIProvider, Date.now() + 60_000);
    const pty = new CountingPTY();
    const chain = new PersistentFallbackChain("claude", [new FailingProvider(), pty]);

    const started = await chain.start();
    const refreshed = await chain.refresh();

    expect(pty.startCallCount).toBe(0);
    expect(pty.refreshCallCount).toBe(0);
    expect(started.source).not.toBe(DataSource.PTY);
    expect(refreshed.source).not.toBe(DataSource.PTY);
    await chain.stop();
  });

  test("claude: PTY is used once the rate limit has expired", async () => {
    setRateLimit(ClaudeAPIProvider, Date.now() - 1);
    const pty = new CountingPTY();
    const chain = new PersistentFallbackChain("claude", [new FailingProvider(), pty]);

    const result = await chain.start();

    expect(pty.startCallCount).toBe(1);
    expect(result.source).toBe(DataSource.PTY);
    await chain.stop();
  });

  test("codex: PTY skipped during a Codex API rate limit", async () => {
    setRateLimit(CodexAPIProvider, Date.now() + 60_000);
    const pty = new CountingPTY();
    const chain = new PersistentFallbackChain("codex", [new FailingProvider(), pty]);

    await chain.start();

    expect(pty.startCallCount).toBe(0);
    await chain.stop();
  });
});
