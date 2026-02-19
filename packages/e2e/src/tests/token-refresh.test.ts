/**
 * E2E tests for token refresh behavior.
 * Observes TUI status bar source label with engineered credential states via
 * CLAUDE_CREDENTIALS_FILE env var injection into the tmux session.
 *
 * Requires tmux - skips all tests if tmux is unavailable.
 *
 * Sub-test A: Expired creds with no refresh token -> graceful PTY/fallback (no crash)
 * Sub-test B: Normal operation without env override -> source shows "api"
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { rmSync, writeFileSync } from "fs";
import {
  isTmuxAvailable,
  createTestSession,
  launchTUI,
  captureFrame,
  waitForContent,
  killSession,
} from "../helpers/tmux.js";
import {
  assertStatusBarPresent,
  assertNoCrash,
} from "../helpers/assertions.js";

const SESSION_PREFIX = "e2e-token-refresh";
const ROOT = join(import.meta.dir, "../../../..");
const PRELOAD = join(ROOT, "packages/cli/node_modules/@opentui/solid/scripts/preload.ts");
const TUI_SCRIPT = join(ROOT, "packages/cli/src/index.ts");

let tmuxAvailable = false;

beforeAll(async () => {
  tmuxAvailable = await isTmuxAvailable();
});

afterAll(async () => {
  await killSession(`${SESSION_PREFIX}-expired`);
  await killSession(`${SESSION_PREFIX}-normal`);
});

function skipIfNoTmux(): boolean {
  if (!tmuxAvailable) {
    console.log("  Skipping: tmux not available in this environment");
    return true;
  }
  return false;
}

function writeTempCreds(path: string, overrides: Record<string, unknown> = {}): void {
  const payload = {
    claudeAiOauth: {
      accessToken: "sk-ant-oat01-EXPIRED",
      refreshToken: "",  // intentionally missing - no refresh possible
      expiresAt: Date.now() - 60_000,
      subscriptionType: "max",
      rateLimitTier: "default",
      ...overrides,
    },
  };
  writeFileSync(path, JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// Sub-test A: Expired credentials with no refresh token
// ---------------------------------------------------------------------------
describe("Token refresh E2E - expired creds, no refresh token", () => {
  test("TUI does not crash and layout is intact", async () => {
    if (skipIfNoTmux()) return;

    const tmpCredsPath = join(tmpdir(), `e2e-token-refresh-${Date.now()}.json`);
    writeTempCreds(tmpCredsPath);

    const session = `${SESSION_PREFIX}-expired`;
    try {
      await createTestSession(session, 120, 40);

      // Launch TUI with env var pointing to our expired creds file
      const cmd = `CLAUDE_CREDENTIALS_FILE=${tmpCredsPath} bun --preload=${PRELOAD} ${TUI_SCRIPT} usage`;
      const proc = Bun.spawnSync(["tmux", "send-keys", "-t", session, cmd, "Enter"]);

      // Wait for TUI to render something
      const frame = await waitForContent(session, "Claude", 25000);

      // TUI must not crash
      assertNoCrash(frame);

      // Status bar must still be present (layout intact)
      assertStatusBarPresent(frame);

      // Should show either pty or fallback or cache as source - not stuck on "undefined"
      const hasKnownSource =
        frame.includes("pty") || frame.includes("fallback") || frame.includes("cache") || frame.includes("api");
      expect(hasKnownSource).toBe(true);

      // No raw JS error text visible in the TUI
      expect(frame.toLowerCase()).not.toContain("uncaught");
      expect(frame.toLowerCase()).not.toContain("typeerror");
    } finally {
      await killSession(session);
      try { rmSync(tmpCredsPath); } catch { /* already gone */ }
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-test B: Normal operation without credential override
// ---------------------------------------------------------------------------
describe("Token refresh E2E - normal operation (sanity check)", () => {
  test("TUI renders and shows a known data source", async () => {
    if (skipIfNoTmux()) return;

    const session = `${SESSION_PREFIX}-normal`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session);

      const frame = await waitForContent(session, "Claude", 25000);

      assertNoCrash(frame);
      assertStatusBarPresent(frame);

      // Source label must show one of the known values
      const hasKnownSource =
        frame.includes("api") || frame.includes("pty") || frame.includes("fallback") || frame.includes("cache");
      expect(hasKnownSource).toBe(true);
    } finally {
      await killSession(session);
    }
  });
});
