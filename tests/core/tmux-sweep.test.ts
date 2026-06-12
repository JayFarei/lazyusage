/**
 * Tests for sweepStaleUsageSessions: garbage collection of collector tmux
 * sessions leaked by force-killed runs (e.g. a closed tmux popup).
 *
 * Requires tmux; all tests skip silently when it is unavailable.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { sweepStaleUsageSessions } from "../../packages/core/src/utils/tmux.js";

function tmux(...args: string[]): { exitCode: number; stdout: string } {
  const proc = Bun.spawnSync(["tmux", ...args], { stdout: "pipe", stderr: "ignore" });
  return { exitCode: proc.exitCode, stdout: proc.stdout.toString() };
}

function tmuxAvailable(): boolean {
  return Bun.spawnSync(["tmux", "-V"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}

function sessionExists(name: string): boolean {
  return tmux("has-session", "-t", name).exitCode === 0;
}

// A pid that is certainly not running (max pid on macOS/Linux is far lower).
const DEAD_PID = 99999999;
const STALE_SESSION = `claude-usage-${DEAD_PID}`;
const LIVE_SESSION = `codex-live-${process.pid}`;
const UNRELATED_SESSION = "lazyusage-sweep-unrelated";

afterEach(() => {
  for (const name of [STALE_SESSION, LIVE_SESSION, UNRELATED_SESSION]) {
    tmux("kill-session", "-t", name);
  }
});

describe("sweepStaleUsageSessions", () => {
  test("kills collector sessions whose owning pid is dead", async () => {
    if (!tmuxAvailable()) return;

    tmux("new-session", "-d", "-s", STALE_SESSION, "sleep 60");
    expect(sessionExists(STALE_SESSION)).toBe(true);

    const killed = await sweepStaleUsageSessions();

    expect(killed).toBeGreaterThanOrEqual(1);
    expect(sessionExists(STALE_SESSION)).toBe(false);
  });

  test("keeps sessions owned by a live pid and unrelated sessions", async () => {
    if (!tmuxAvailable()) return;

    tmux("new-session", "-d", "-s", LIVE_SESSION, "sleep 60");
    tmux("new-session", "-d", "-s", UNRELATED_SESSION, "sleep 60");

    await sweepStaleUsageSessions();

    expect(sessionExists(LIVE_SESSION)).toBe(true);
    expect(sessionExists(UNRELATED_SESSION)).toBe(true);
  });

  test("returns 0 when no stale sessions remain", async () => {
    if (!tmuxAvailable()) return;

    // First sweep clears any genuinely leaked sessions on this machine.
    await sweepStaleUsageSessions();
    const killed = await sweepStaleUsageSessions();
    expect(killed).toBe(0);
  });
});
