/**
 * Phase 5: Multi-resolution E2E TUI rendering tests.
 * Tests the TUI at 5 different terminal sizes via tmux.
 *
 * Requires tmux - skips all tests if tmux is unavailable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BAR_WIDTH_STEP, MIN_BAR_WIDTH } from "@lazyusage/core/utils/bars.js";
import {
  assertLayoutIntact,
  assertMarkersEquidistant,
  assertNoCrash,
  assertStatusBarPresent,
} from "../helpers/assertions.js";
import { extractBarWidths } from "../helpers/markers.js";
import {
  captureFrame,
  createDirectTUISession,
  createTestSession,
  isTmuxAvailable,
  killSession,
  launchTUI,
  resizeSession,
  sendKey,
  waitForContent,
  waitForSessionExit,
} from "../helpers/tmux.js";

// Session name prefix for this test file
const SESSION_PREFIX = "e2e-res";

let tmuxAvailable = false;

beforeAll(async () => {
  tmuxAvailable = await isTmuxAvailable();
});

afterAll(async () => {
  // Clean up any orphaned sessions from this test run
  for (const res of ["70x35", "80x24", "120x40", "200x60", "60x20", "resize"]) {
    await killSession(`${SESSION_PREFIX}-${res}`);
  }
});

function skipIfNoTmux() {
  if (!tmuxAvailable) {
    console.log("  Skipping: tmux not available in this environment");
    return true;
  }
  return false;
}

// Helper to compute expected bar width for a given terminal width
function _expectedBarWidth(terminalWidth: number): number {
  const panelCols = Math.floor(terminalWidth * 0.4) - 4;
  const overhead = 12;
  const raw = panelCols - overhead;
  const snapped = Math.floor(raw / BAR_WIDTH_STEP) * BAR_WIDTH_STEP;
  return Math.max(MIN_BAR_WIDTH, Math.min(snapped, 315));
}

// ---------------------------------------------------------------------------
// 70x35 (minimum supported)
// ---------------------------------------------------------------------------
describe("Resolution 70x35 (minimum supported)", () => {
  test("renders layout with both panels and status bar", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-70x35`;
    try {
      await createTestSession(session, 70, 35);
      await launchTUI(session);
      const frame = await waitForContent(session, "Claude CLI", 20000);
      expect(frame).toContain("Claude CLI");
      expect(frame).toContain("Codex CLI");
      assertStatusBarPresent(frame);
      assertNoCrash(frame);
    } finally {
      await killSession(session);
    }
  });

  test("time markers are equidistant", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-70x35-markers`;
    try {
      await createTestSession(session, 70, 35);
      await launchTUI(session);
      const frame = await waitForContent(session, "Claude CLI", 20000);
      assertMarkersEquidistant(frame);
    } finally {
      await killSession(session);
    }
  });

  test("help overlay shows on ? key", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-70x35-help`;
    try {
      await createTestSession(session, 70, 35);
      await launchTUI(session);
      await waitForContent(session, "Claude CLI", 20000);
      await sendKey(session, "?");
      await Bun.sleep(500);
      const frame = await captureFrame(session);
      expect(frame).toContain("Keyboard Shortcuts");
    } finally {
      await killSession(session);
    }
  });

  test("quits cleanly on q key", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-70x35-quit`;
    try {
      // Run TUI directly (no shell wrapper) so session dies when TUI exits
      await createDirectTUISession(session, 70, 35);
      await waitForContent(session, "Claude CLI", 20000);
      // Allow keyboard handler to fully activate before sending keys
      await Bun.sleep(2000);
      await sendKey(session, "q");
      const exited = await waitForSessionExit(session, 15000);
      expect(exited).toBe(true);
    } finally {
      await killSession(session);
    }
  });
});

// ---------------------------------------------------------------------------
// 80x24 (classic terminal)
// ---------------------------------------------------------------------------
describe("Resolution 80x24 (classic terminal)", () => {
  test("renders at least Claude panel and status bar", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-80x24`;
    try {
      await createTestSession(session, 80, 24);
      await launchTUI(session);
      const frame = await waitForContent(session, "Claude CLI", 20000);
      expect(frame).toContain("Claude CLI");
      assertStatusBarPresent(frame);
      assertNoCrash(frame);
    } finally {
      await killSession(session);
    }
  });

  test("time markers equidistant at 80 cols", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-80x24-markers`;
    try {
      await createTestSession(session, 80, 24);
      await launchTUI(session);
      const frame = await waitForContent(session, "Claude CLI", 20000);
      assertMarkersEquidistant(frame);
    } finally {
      await killSession(session);
    }
  });
});

// ---------------------------------------------------------------------------
// 120x40 (medium - default experience)
// ---------------------------------------------------------------------------
describe("Resolution 120x40 (medium)", () => {
  test("renders full layout with bars and markers", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-120x40`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session);
      const _frame = await waitForContent(session, "Claude CLI", 20000);
      // Wait extra time for metrics to load and bars to render
      await Bun.sleep(3000);
      const fullFrame = await captureFrame(session);
      assertLayoutIntact(fullFrame);
      assertStatusBarPresent(fullFrame);
      assertNoCrash(fullFrame);
      // Bars should be visible at 120 cols (barWidth = 35)
      const barLines = extractBarWidths(fullFrame);
      expect(barLines.length).toBeGreaterThan(0);
    } finally {
      await killSession(session);
    }
  });

  test("time markers are equidistant at 120 cols", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-120x40-markers`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session);
      await waitForContent(session, "Claude CLI", 20000);
      await Bun.sleep(2000);
      const frame = await captureFrame(session);
      assertMarkersEquidistant(frame);
    } finally {
      await killSession(session);
    }
  });

  test("both panels render with all metric groups", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-120x40-full`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session);
      const frame = await waitForContent(session, "Codex CLI", 20000);
      expect(frame).toContain("Claude CLI");
      expect(frame).toContain("Codex CLI");
    } finally {
      await killSession(session);
    }
  });

  test("? opens help overlay, Escape closes it", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-120x40-help`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session);
      await waitForContent(session, "Claude CLI", 20000);

      // Open help
      await sendKey(session, "?");
      await Bun.sleep(500);
      const helpFrame = await captureFrame(session);
      expect(helpFrame).toContain("Keyboard Shortcuts");

      // Close with Escape
      await sendKey(session, "Escape");
      await Bun.sleep(500);
      const closedFrame = await captureFrame(session);
      expect(closedFrame).not.toContain("Keyboard Shortcuts");
    } finally {
      await killSession(session);
    }
  });
});

// ---------------------------------------------------------------------------
// 200x60 (large terminal)
// ---------------------------------------------------------------------------
describe("Resolution 200x60 (large)", () => {
  test("renders layout without truncation", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-200x60`;
    try {
      await createTestSession(session, 200, 60);
      await launchTUI(session);
      const frame = await waitForContent(session, "Claude CLI", 20000);
      assertLayoutIntact(frame);
      assertStatusBarPresent(frame);
      assertNoCrash(frame);
    } finally {
      await killSession(session);
    }
  });

  test("time markers equidistant at 200 cols", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-200x60-markers`;
    try {
      await createTestSession(session, 200, 60);
      await launchTUI(session);
      await waitForContent(session, "Claude CLI", 20000);
      await Bun.sleep(2000);
      const frame = await captureFrame(session);
      assertMarkersEquidistant(frame);
    } finally {
      await killSession(session);
    }
  });
});

// ---------------------------------------------------------------------------
// 60x20 (below minimum - graceful degradation)
// ---------------------------------------------------------------------------
describe("Resolution 60x20 (below minimum)", () => {
  test("process does not crash at very small terminal", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-60x20`;
    try {
      await createTestSession(session, 60, 20);
      await launchTUI(session);
      // Wait 8 seconds - process should survive
      await Bun.sleep(8000);
      // Session should still exist (process alive)
      const exitCode = await Bun.spawn(["tmux", "has-session", "-t", session], {
        stdout: "ignore",
        stderr: "ignore",
      }).exited;
      // If session still exists, no crash
      // (TUI may render garbage at this size but must not crash)
      expect(exitCode).toBe(0);
    } finally {
      await killSession(session);
    }
  });
});

// ---------------------------------------------------------------------------
// Resize during runtime
// ---------------------------------------------------------------------------
describe("Resize during runtime", () => {
  test("TUI recovers after terminal resize", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-resize`;
    try {
      // Start at 120x40
      await createTestSession(session, 120, 40);
      await launchTUI(session);
      const initialFrame = await waitForContent(session, "Claude CLI", 20000);
      expect(initialFrame).toContain("Claude CLI");

      // Resize to 80x24
      await resizeSession(session, 80, 24);
      await Bun.sleep(2000);
      const resizedFrame = await captureFrame(session);
      expect(resizedFrame).toContain("Claude CLI"); // Still renders
      assertNoCrash(resizedFrame);

      // Resize back to 120x40
      await resizeSession(session, 120, 40);
      await Bun.sleep(2000);
      const recoveredFrame = await captureFrame(session);
      expect(recoveredFrame).toContain("Claude CLI");
      assertNoCrash(recoveredFrame);
    } finally {
      await killSession(session);
    }
  });
});
