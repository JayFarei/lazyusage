/**
 * Unit tests for CodexSessionProvider.
 * Uses temp directories with JSONL files to test session file parsing.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CodexSessionProvider } from "../../packages/core/src/providers/session-codex.js";
import { DataSource } from "../../packages/core/src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempCodexHome(): string {
  return mkdtempSync(join(tmpdir(), "codex-session-test-"));
}

function makeSessionFile(baseDir: string, filename: string, lines: string[]): void {
  const sessionsDir = join(baseDir, "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, filename), lines.join("\n") + "\n");
}

function makeArchivedSessionFile(baseDir: string, filename: string, lines: string[]): void {
  const archivedDir = join(baseDir, "archived_sessions");
  mkdirSync(archivedDir, { recursive: true });
  writeFileSync(join(archivedDir, filename), lines.join("\n") + "\n");
}

function makeRateLimitEvent(overrides: Record<string, unknown> = {}): string {
  const rl = {
    plan_type: "pro",
    primary: {
      used_percent: 42,
      window_minutes: 300,
      resets_at: 1740000000,
    },
    secondary: {
      used_percent: 15,
      window_minutes: 10080,
      resets_at: 1740500000,
    },
    ...overrides,
  };
  return JSON.stringify({
    type: "event_msg",
    payload: { type: "token_count", rate_limits: rl },
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
  tempDirs.length = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CodexSessionProvider - isAvailable", () => {
  test("returns false when no session files exist", () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);
    const provider = new CodexSessionProvider(baseDir);
    expect(provider.isAvailable()).toBe(false);
  });

  test("returns false when sessions dir does not exist", () => {
    const baseDir = join(tmpdir(), `nonexistent-${Date.now()}`);
    const provider = new CodexSessionProvider(baseDir);
    expect(provider.isAvailable()).toBe(false);
  });

  test("returns true when JSONL files exist", () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);
    makeSessionFile(baseDir, "session-1.jsonl", [makeRateLimitEvent()]);
    const provider = new CodexSessionProvider(baseDir);
    expect(provider.isAvailable()).toBe(true);
  });
});

describe("CodexSessionProvider - fetch", () => {
  test("returns metrics from a valid session file with rate_limits", async () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);
    makeSessionFile(baseDir, "session-1.jsonl", [makeRateLimitEvent()]);

    const provider = new CodexSessionProvider(baseDir);
    const result = await provider.fetch();

    expect(result.error).toBeNull();
    expect(result.source).toBe(DataSource.API);
    expect(result.metrics).not.toBeNull();
    expect(result.metrics!["5h"]).toBeDefined();
    expect(result.metrics!["weekly"]).toBeDefined();
    expect((result.metrics!["5h"] as { used_pct: number }).used_pct).toBe(42);
    expect((result.metrics!["weekly"] as { used_pct: number }).used_pct).toBe(15);
  });

  test("skips files without rate_limits events", async () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);

    // File with no rate_limits
    makeSessionFile(baseDir, "no-rl.jsonl", [
      JSON.stringify({ type: "event_msg", payload: { type: "text_delta", content: "hello" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "done" } }),
    ]);

    const provider = new CodexSessionProvider(baseDir);
    const result = await provider.fetch();

    expect(result.error).not.toBeNull();
    expect(result.error).toContain("No rate_limits found");
    expect(result.metrics).toBeNull();
  });

  test("reads from the last token_count event, not first", async () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);

    const earlyEvent = makeRateLimitEvent({
      primary: { used_percent: 10, window_minutes: 300, resets_at: 1740000000 },
      secondary: { used_percent: 5, window_minutes: 10080, resets_at: 1740500000 },
    });
    const lateEvent = makeRateLimitEvent({
      primary: { used_percent: 80, window_minutes: 300, resets_at: 1740000000 },
      secondary: { used_percent: 60, window_minutes: 10080, resets_at: 1740500000 },
    });

    makeSessionFile(baseDir, "session-1.jsonl", [earlyEvent, lateEvent]);

    const provider = new CodexSessionProvider(baseDir);
    const result = await provider.fetch();

    expect(result.error).toBeNull();
    // Should read the LAST event (80%, not 10%)
    expect((result.metrics!["5h"] as { used_pct: number }).used_pct).toBe(80);
    expect((result.metrics!["weekly"] as { used_pct: number }).used_pct).toBe(60);
  });

  test("returns error when no rate_limits found in any file", async () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);

    // Empty sessions dir
    mkdirSync(join(baseDir, "sessions"), { recursive: true });

    const provider = new CodexSessionProvider(baseDir);
    const result = await provider.fetch();

    expect(result.metrics).toBeNull();
    expect(result.error).toContain("No rate_limits found");
  });
});

describe("CodexSessionProvider - _parseRateLimits plan mapping", () => {
  test("maps 'pro' plan type to 'Pro'", async () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);
    makeSessionFile(baseDir, "session-1.jsonl", [
      makeRateLimitEvent({ plan_type: "pro" }),
    ]);

    const provider = new CodexSessionProvider(baseDir);
    const result = await provider.fetch();

    expect(result.metrics!.subscription_type).toBe("Pro");
  });

  test("maps 'plus' plan type to 'Plus'", async () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);
    makeSessionFile(baseDir, "session-1.jsonl", [
      makeRateLimitEvent({ plan_type: "plus" }),
    ]);

    const provider = new CodexSessionProvider(baseDir);
    const result = await provider.fetch();

    expect(result.metrics!.subscription_type).toBe("Plus");
  });

  test("maps 'team' plan type to 'Team'", async () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);
    makeSessionFile(baseDir, "session-1.jsonl", [
      makeRateLimitEvent({ plan_type: "team" }),
    ]);

    const provider = new CodexSessionProvider(baseDir);
    const result = await provider.fetch();

    expect(result.metrics!.subscription_type).toBe("Team");
  });

  test("preserves unknown plan type as-is", async () => {
    const baseDir = makeTempCodexHome();
    tempDirs.push(baseDir);
    makeSessionFile(baseDir, "session-1.jsonl", [
      makeRateLimitEvent({ plan_type: "custom_plan" }),
    ]);

    const provider = new CodexSessionProvider(baseDir);
    const result = await provider.fetch();

    expect(result.metrics!.subscription_type).toBe("custom_plan");
  });
});
