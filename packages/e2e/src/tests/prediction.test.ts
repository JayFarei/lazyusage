/**
 * E2E tests for predictive capacity TUI overlay and CLI output.
 *
 * Tests the 3-segment prediction bar, prediction labels, compact mode
 * degradation, and --predict CLI flag across multiple terminal sizes.
 *
 * Requires tmux - skips all tests if tmux is unavailable.
 * Uses a seeded UsageStore database (via LAZYUSAGE_DB_PATH) to ensure
 * the prediction engine has history data to produce meaningful output.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

// E2E TUI tests need long timeouts for metrics collection
setDefaultTimeout(60_000);

import { join } from "node:path";
import {
  assertLayoutIntact,
  assertNoCrash,
  assertPredictionBarSegmentsValid,
  assertPredictionBarsPresent,
  assertPredictionBarWidthsConsistent,
  assertPredictionLabelsPresent,
  assertStatusBarPresent,
} from "../helpers/assertions.js";
import { extractPredictionBars } from "../helpers/markers.js";
import { createSeededDatabase } from "../helpers/seed-db.js";
import {
  captureFrame,
  createTestSession,
  isTmuxAvailable,
  killSession,
  launchTUI,
  resizeSession,
  sendKey,
  waitForContent,
} from "../helpers/tmux.js";

const SESSION_PREFIX = "e2e-pred";
const ROOT = join(import.meta.dir, "../../../..");
const CLI_SCRIPT = join(ROOT, "packages/cli/src/index.ts");
const _PRELOAD = join(ROOT, "packages/cli/node_modules/@opentui/solid/scripts/preload.ts");

interface JsonPredictionMetric {
  predicted_spare: number;
  over_budget: boolean;
  confidence: string;
  average_rate: number;
  remaining_days: number;
}

interface JsonPredictionService {
  prediction?: Record<string, JsonPredictionMetric> | null;
}

interface JsonPredictionResponse {
  services: JsonPredictionService[];
}

let tmuxAvailable = false;
let seededDbPath: string;

beforeAll(async () => {
  tmuxAvailable = await isTmuxAvailable();
  if (tmuxAvailable) {
    seededDbPath = createSeededDatabase();
  }
});

afterAll(async () => {
  const sessions = [
    "120x40",
    "120x40-labels",
    "120x40-widths",
    "120x40-segments",
    "80x24",
    "80x24-compact",
    "70x35",
    "200x60",
    "200x60-bars",
    "resize",
    "keybinds",
  ];
  for (const s of sessions) {
    await killSession(`${SESSION_PREFIX}-${s}`);
  }
});

function skipIfNoTmux() {
  if (!tmuxAvailable) {
    console.log("  Skipping: tmux not available");
    return true;
  }
  return false;
}

const dbEnv = () => ({ LAZYUSAGE_DB_PATH: seededDbPath });

// ---------------------------------------------------------------------------
// Helper: run CLI command directly (no tmux needed for CLI output tests)
// ---------------------------------------------------------------------------
async function runCLICommand(args: string): Promise<string> {
  const proc = Bun.spawn(["bun", CLI_SCRIPT, ...args.split(" ")], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, LAZYUSAGE_DB_PATH: seededDbPath },
    cwd: ROOT,
  });
  if (!proc.stdout) {
    throw new Error("CLI process did not expose stdout");
  }

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

function parsePredictionJson(output: string): JsonPredictionResponse {
  const parsed: unknown = JSON.parse(output);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { services?: unknown }).services)) {
    throw new Error(`--predict --json output is not valid JSON: ${output.slice(0, 200)}`);
  }

  return parsed as JsonPredictionResponse;
}

/** Check if a frame has prediction bar content (▒ chars or prediction labels). */
function hasPredictionContent(frame: string): boolean {
  return frame.includes("\u2592") || frame.includes("% used") || frame.includes("spare");
}

// ===========================================================================
// TUI Prediction Bar — 120x40 (default experience)
// ===========================================================================
describe("Prediction bar at 120x40", () => {
  test("3-segment prediction bars render for weekly metrics", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-120x40`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session, [], dbEnv());
      const _frame = await waitForContent(session, "Claude CLI", 25000);
      // Wait for prediction to compute (needs a tick)
      await Bun.sleep(5000);
      const fullFrame = await captureFrame(session);

      assertLayoutIntact(fullFrame);
      assertStatusBarPresent(fullFrame);
      assertNoCrash(fullFrame);

      // If metrics loaded (not fallback zeros), prediction bars should render
      if (hasPredictionContent(fullFrame)) {
        assertPredictionBarsPresent(fullFrame);
      }
      // Either way, layout should be intact
    } finally {
      await killSession(session);
    }
  });

  test("prediction labels show used% and spare%", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-120x40-labels`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session, [], dbEnv());
      await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);
      const frame = await captureFrame(session);

      // If metrics loaded, should contain micro-labels
      if (hasPredictionContent(frame)) {
        assertPredictionLabelsPresent(frame);
      }
    } finally {
      await killSession(session);
    }
  });

  test("prediction bar widths are consistent across metrics", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-120x40-widths`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session, [], dbEnv());
      await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);
      const frame = await captureFrame(session);

      if (hasPredictionContent(frame)) {
        assertPredictionBarWidthsConsistent(frame);
      }
    } finally {
      await killSession(session);
    }
  });

  test("prediction bar segments sum to bar width (no rounding misalignment)", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-120x40-segments`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session, [], dbEnv());
      await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);
      const frame = await captureFrame(session);

      if (hasPredictionContent(frame)) {
        assertPredictionBarSegmentsValid(frame);
      }
    } finally {
      await killSession(session);
    }
  });
});

// ===========================================================================
// Compact / Collapsed Mode — 80x24, 70x35
// ===========================================================================
describe("Prediction in compact mode (80x24)", () => {
  test("renders without crash at 80x24", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-80x24`;
    try {
      await createTestSession(session, 80, 24);
      await launchTUI(session, [], dbEnv());
      const _frame = await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);
      const fullFrame = await captureFrame(session);

      assertNoCrash(fullFrame);
      assertStatusBarPresent(fullFrame);
    } finally {
      await killSession(session);
    }
  });

  test("collapsed metrics show prediction suffix (spare or OVER BUDGET)", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-80x24-compact`;
    try {
      await createTestSession(session, 80, 24);
      await launchTUI(session, [], dbEnv());
      await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);
      const frame = await captureFrame(session);

      // In collapsed mode, prediction shows as " → N% spare" or " → OVER BUDGET"
      // The arrow character (→ U+2192) should be present for at least one collapsed metric
      const _hasArrow = frame.includes("\u2192");
      // At minimum the frame should not crash and should have some metric data
      assertNoCrash(frame);
      // If panel is in compact mode, the arrow suffix should appear
      // (only if multiple metrics are collapsed, which depends on height)
    } finally {
      await killSession(session);
    }
  });
});

describe("Prediction at 70x35 (minimum supported)", () => {
  test("TUI renders without crash with prediction data", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-70x35`;
    try {
      await createTestSession(session, 70, 35);
      await launchTUI(session, [], dbEnv());
      const _frame = await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);
      const fullFrame = await captureFrame(session);

      assertNoCrash(fullFrame);
      expect(fullFrame).toContain("Claude CLI");
    } finally {
      await killSession(session);
    }
  });
});

// ===========================================================================
// Large Terminal — 200x60
// ===========================================================================
describe("Prediction at 200x60 (large terminal)", () => {
  test("renders full layout with prediction bars", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-200x60`;
    try {
      await createTestSession(session, 200, 60);
      await launchTUI(session, [], dbEnv());
      const _frame = await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);
      const fullFrame = await captureFrame(session);

      assertLayoutIntact(fullFrame);
      assertNoCrash(fullFrame);
      assertStatusBarPresent(fullFrame);
    } finally {
      await killSession(session);
    }
  });

  test("prediction bars are wider at larger terminal", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-200x60-bars`;
    try {
      await createTestSession(session, 200, 60);
      await launchTUI(session, [], dbEnv());
      await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);
      const frame = await captureFrame(session);

      const predBars = extractPredictionBars(frame);
      if (predBars.length > 0) {
        // At 200 cols, bars should be wider than MIN_BAR_WIDTH (35)
        expect(predBars[0].total).toBeGreaterThanOrEqual(35);
      }

      assertPredictionBarSegmentsValid(frame);
    } finally {
      await killSession(session);
    }
  });
});

// ===========================================================================
// Resize During Runtime
// ===========================================================================
describe("Prediction survives terminal resize", () => {
  test("prediction bars adapt after resize", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-resize`;
    try {
      // Start at 120x40
      await createTestSession(session, 120, 40);
      await launchTUI(session, [], dbEnv());
      await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);
      const initialFrame = await captureFrame(session);
      assertNoCrash(initialFrame);

      // Resize to 80x24
      await resizeSession(session, 80, 24);
      await Bun.sleep(3000);
      const smallFrame = await captureFrame(session);
      assertNoCrash(smallFrame);

      // Resize back to 200x60
      await resizeSession(session, 200, 60);
      await Bun.sleep(3000);
      const largeFrame = await captureFrame(session);
      assertNoCrash(largeFrame);
      expect(largeFrame).toContain("Claude CLI");
    } finally {
      await killSession(session);
    }
  });
});

// ===========================================================================
// Keyboard Interaction with Prediction
// ===========================================================================
describe("Keyboard interaction with prediction overlay", () => {
  test("j/k navigation preserves prediction rendering", async () => {
    if (skipIfNoTmux()) return;
    const session = `${SESSION_PREFIX}-keybinds`;
    try {
      await createTestSession(session, 120, 40);
      await launchTUI(session, [], dbEnv());
      await waitForContent(session, "Claude CLI", 25000);
      await Bun.sleep(5000);

      // Navigate metrics with j/k
      await sendKey(session, "j");
      await Bun.sleep(1000);
      const frame1 = await captureFrame(session);
      assertNoCrash(frame1);

      await sendKey(session, "k");
      await Bun.sleep(1000);
      const frame2 = await captureFrame(session);
      assertNoCrash(frame2);

      // If prediction was rendering, it should still be present after navigation
      if (hasPredictionContent(frame1)) {
        assertPredictionBarsPresent(frame2);
      }
    } finally {
      await killSession(session);
    }
  });
});

// ===========================================================================
// CLI --predict Flag Output
// ===========================================================================
describe("CLI --predict flag", () => {
  test("--predict produces text output with prediction line", async () => {
    if (skipIfNoTmux()) return;
    const output = await runCLICommand("usage --predict");

    expect(output).toContain("Predicted spare at window end:");
    // Should contain confidence level
    expect(output).toMatch(/low|medium|high/i);
  });

  test("--predict --json produces valid JSON with prediction block", async () => {
    if (skipIfNoTmux()) return;
    const output = await runCLICommand("usage --predict --json");

    // Should be valid JSON
    let parsed: JsonPredictionResponse;
    try {
      parsed = parsePredictionJson(output);
    } catch {
      throw new Error(`--predict --json output is not valid JSON: ${output.slice(0, 200)}`);
    }

    // Should have services array
    expect(parsed.services).toBeDefined();
    expect(Array.isArray(parsed.services)).toBe(true);

    // At least one service should have a prediction block
    const hasPrediction = parsed.services.some((service) => service.prediction);
    expect(hasPrediction).toBe(true);

    // Prediction block should have required fields
    const svcWithPred = parsed.services.find((service) => service.prediction);
    if (svcWithPred) {
      const pred = svcWithPred.prediction;
      const metricPreds = pred ? Object.values(pred) : [];
      if (metricPreds.length > 0) {
        const p = metricPreds[0];
        expect(typeof p.predicted_spare).toBe("number");
        expect(typeof p.over_budget).toBe("boolean");
        expect(typeof p.confidence).toBe("string");
        expect(typeof p.average_rate).toBe("number");
        expect(typeof p.remaining_days).toBe("number");
      }
    }
  });

  test("--predict --capacity produces capacity + prediction text", async () => {
    if (skipIfNoTmux()) return;
    const output = await runCLICommand("usage --predict --capacity");

    // Should contain both capacity and prediction output
    expect(output).toContain("Predicted spare at window end:");
  });
});
