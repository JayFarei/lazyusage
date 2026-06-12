/**
 * Phase 7: Visual equivalency tests (golden master comparison).
 *
 * Captures fresh frames at 4 resolutions and compares their structural
 * invariants against the golden masters captured before any code changes.
 *
 * Only structural invariants are compared (not live metric values):
 *   - Panel presence (hasClaude, hasCodex, hasStatusBar)
 *   - Border characters found
 *   - Bar width totals (all bars same width)
 *   - Time marker gap equidistance and count
 *   - Panel title line count (both panels present)
 *
 * Requires tmux - skips all tests if tmux unavailable.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { extractStructuralInvariants } from "../helpers/golden.js";
import {
  captureFrame,
  createTestSession,
  isTmuxAvailable,
  killSession,
  launchTUI,
  waitForContent,
} from "../helpers/tmux.js";

const GOLDEN_DIR = join(import.meta.dir, "../../golden");

const RESOLUTIONS = [
  { width: 70, height: 35 },
  { width: 80, height: 24 },
  { width: 120, height: 40 },
  { width: 200, height: 60 },
] as const;

let tmuxAvailable = false;

beforeAll(async () => {
  tmuxAvailable = await isTmuxAvailable();
});

afterAll(async () => {
  for (const { width, height } of RESOLUTIONS) {
    await killSession(`e2e-vis-${width}x${height}`);
  }
});

function skipIfNoTmux() {
  if (!tmuxAvailable) {
    console.log("  Skipping: tmux not available in this environment");
    return true;
  }
  return false;
}

/** Load a golden JSON file; returns null if not found. */
async function loadGolden(width: number, height: number): Promise<Record<string, unknown> | null> {
  try {
    const file = Bun.file(`${GOLDEN_DIR}/${width}x${height}.json`);
    const text = await file.text();
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Capture a fresh frame at a given resolution and extract its structural invariants. */
async function captureFreshInvariants(width: number, height: number): Promise<Record<string, unknown>> {
  const session = `e2e-vis-${width}x${height}`;
  await killSession(session);
  await createTestSession(session, width, height);
  await launchTUI(session);

  // Wait for initial render
  await waitForContent(session, "Claude CLI", 20000);
  // Extra settle for bars to appear
  await Bun.sleep(3000);

  const frame = await captureFrame(session);
  const inv = extractStructuralInvariants(frame, width, height);
  await killSession(session);
  return inv as unknown as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// One describe block per resolution
// ---------------------------------------------------------------------------

for (const { width, height } of RESOLUTIONS) {
  describe(`Visual equivalency ${width}x${height}`, () => {
    test("structural invariants match golden master", async () => {
      if (skipIfNoTmux()) return;

      const golden = await loadGolden(width, height);
      if (!golden) {
        console.log(`  No golden master for ${width}x${height} - skipping comparison`);
        return;
      }

      const current = await captureFreshInvariants(width, height);

      // --- Panel presence ---
      expect(current.hasClaude).toBe(golden.hasClaude);
      expect(current.hasCodex).toBe(golden.hasCodex);
      expect(current.hasStatusBar).toBe(golden.hasStatusBar);

      // --- Border characters ---
      // Current should contain at least all border chars the golden had
      const goldenBorders = golden.borderCharsFound as string[];
      const currentBorders = current.borderCharsFound as string[];
      for (const bc of goldenBorders) {
        expect(currentBorders).toContain(bc);
      }

      // --- Bars ---
      // If golden had bars, current should also have bars with matching widths.
      // Count may vary with loaded data, so we only verify width consistency.
      if (golden.hasBars) {
        expect(current.hasBars).toBe(true);
        const goldenBars = golden.barLines as Array<{ lineIndex: number; total: number }>;
        const currentBars = current.barLines as Array<{ lineIndex: number; total: number }>;
        const goldenBarWidth = goldenBars[0]?.total ?? 35;
        // All rendered bars must match the golden bar width
        for (const bar of currentBars) {
          expect(bar.total).toBe(goldenBarWidth);
        }
        // At least one bar should be present
        expect(currentBars.length).toBeGreaterThan(0);
      }

      // --- Time markers ---
      // If golden had markers, current should also have markers.
      // Row count may vary with live data (metric groups not rendered if no data),
      // so we only verify that every rendered marker row is equidistant and that
      // the gap value matches the golden gap for that resolution.
      if (golden.hasTimerMarkers) {
        expect(current.hasTimerMarkers).toBe(true);
        const goldenMarkers = golden.markerLines as Array<{
          lineIndex: number;
          positions: number[];
          gap: number;
          valid: boolean;
        }>;
        const currentMarkers = current.markerLines as Array<{
          lineIndex: number;
          positions: number[];
          gap: number;
          valid: boolean;
        }>;
        // At least one marker row should be present
        expect(currentMarkers.length).toBeGreaterThan(0);
        // All rendered marker rows must be valid (equidistant)
        for (const ml of currentMarkers) {
          expect(ml.valid).toBe(true);
        }
        // Collect the distinct gap values from golden (may differ across metric groups)
        const goldenGaps = new Set(goldenMarkers.map((m) => m.gap));
        // Every current marker gap should be a value that appeared in the golden
        for (const ml of currentMarkers) {
          expect(goldenGaps.has(ml.gap)).toBe(true);
        }
      }

      // --- Panel title lines count ---
      // Both panels should render (or not) the same as in the golden.
      const goldenTitleLines = golden.panelTitleLines as number[];
      const currentTitleLines = current.panelTitleLines as number[];
      expect(currentTitleLines.length).toBe(goldenTitleLines.length);

      // --- Structural line count tolerance ---
      // Allow ±4 lines variance: data rows may appear/disappear based on which
      // metrics loaded (e.g., Codex might have no data at small resolutions).
      const goldenLineCount = golden.structuralLineCount as number;
      const currentLineCount = current.structuralLineCount as number;
      expect(Math.abs(currentLineCount - goldenLineCount)).toBeLessThanOrEqual(4);
    });
  });
}
