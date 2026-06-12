/**
 * Golden master capture utilities for visual regression testing.
 *
 * Captures the TUI at specific terminal resolutions before any code changes,
 * storing only structural invariants (not live metric values which change).
 *
 * Stored invariants:
 *   - layout: border chars, panel title positions, structural line count
 *   - markers: time marker column positions per bar line
 *   - barWidths: bar fill widths per bar line
 *   - resolution: the width x height at capture time
 */

import { extractAllMarkers, extractBarWidths } from "./markers.js";

interface StructuralInvariants {
  resolution: { width: number; height: number };
  capturedAt: string;
  hasClaude: boolean;
  hasCodex: boolean;
  hasStatusBar: boolean;
  hasTimerMarkers: boolean;
  hasBars: boolean;
  markerLines: Array<{
    lineIndex: number;
    positions: number[];
    gap: number | null;
    valid: boolean;
  }>;
  barLines: Array<{
    lineIndex: number;
    total: number;
  }>;
  structuralLineCount: number;
  borderCharsFound: string[];
  panelTitleLines: number[];
}

/**
 * Extract structural invariants from a raw tmux capture string.
 * Strips data-dependent values (percentages, times) and keeps layout structure.
 */
export function extractStructuralInvariants(frame: string, width: number, height: number): StructuralInvariants {
  const lines = frame.split("\n");

  // Detect presence of panel titles
  const hasClaude = frame.includes("Claude CLI");
  const hasCodex = frame.includes("Codex CLI");
  const hasStatusBar = frame.includes("Auto-refresh:");
  const hasTimerMarkers = frame.includes("\u2503");
  const hasBars = frame.includes("\u2593") || frame.includes("\u2591");

  // Find panel title line indices
  const panelTitleLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("Claude CLI") || lines[i].includes("Codex CLI")) {
      panelTitleLines.push(i);
    }
  }

  // Collect unique border chars present
  const borderCharsFound: string[] = [];
  const borderChars = ["\u2502", "\u2500", "\u256d", "\u256e", "\u2570", "\u256f", "\u251c", "\u2524"];
  for (const c of borderChars) {
    if (frame.includes(c)) borderCharsFound.push(c);
  }

  // Extract marker and bar data
  const allMarkers = extractAllMarkers(frame);
  const allBars = extractBarWidths(frame);

  // Count structural lines (lines containing border/bar/marker chars)
  const structuralLineCount = lines.filter(
    (l) =>
      l.includes("\u2502") ||
      l.includes("\u2500") ||
      l.includes("\u2593") ||
      l.includes("\u2591") ||
      l.includes("\u2503"),
  ).length;

  return {
    resolution: { width, height },
    capturedAt: new Date().toISOString(),
    hasClaude,
    hasCodex,
    hasStatusBar,
    hasTimerMarkers,
    hasBars,
    markerLines: allMarkers.map(({ lineIndex, positions, gap, valid }) => ({
      lineIndex,
      positions,
      gap,
      valid,
    })),
    barLines: allBars.map(({ lineIndex, total }) => ({ lineIndex, total })),
    structuralLineCount,
    borderCharsFound,
    panelTitleLines,
  };
}

/** Run a tmux command and return exit code + stdout */
async function runTmux(
  args: string[],
  opts: { capture?: boolean; suppressErrors?: boolean } = {},
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["tmux", ...args], {
    stdout: opts.capture ? "pipe" : "ignore",
    stderr: opts.suppressErrors ? "ignore" : "pipe",
  });
  const stdout = opts.capture && proc.stdout ? await new Response(proc.stdout).text() : "";
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

/** Poll tmux session until the frame contains the marker text, or timeout. */
async function waitForContent(session: string, marker: string, timeoutMs = 20000, intervalMs = 500): Promise<string> {
  let elapsed = 0;
  let frame = "";
  while (elapsed < timeoutMs) {
    await Bun.sleep(intervalMs);
    elapsed += intervalMs;
    const { stdout } = await runTmux(["capture-pane", "-t", session, "-p"], { capture: true, suppressErrors: true });
    frame = stdout;
    if (frame.includes(marker)) return frame;
  }
  return frame;
}

export interface CaptureResult {
  width: number;
  height: number;
  textFrame: string;
  invariants: StructuralInvariants;
}

/**
 * Capture the TUI at a specific resolution.
 * Launches TUI in a dedicated tmux session, waits for render, captures, kills session.
 */
export async function captureAtResolution(
  width: number,
  height: number,
  tuiCommand: string,
  sessionPrefix = "golden-capture",
): Promise<CaptureResult> {
  const session = `${sessionPrefix}-${width}x${height}`;

  // Kill any existing session with this name
  await runTmux(["kill-session", "-t", session], { suppressErrors: true });

  // Create new session at target size
  await runTmux(["new-session", "-d", "-s", session, "-x", String(width), "-y", String(height)]);

  // Send TUI launch command
  await runTmux(["send-keys", "-t", session, tuiCommand, "Enter"]);

  // Wait for TUI to render (poll for "Claude CLI" which appears once layout is ready)
  const frame = await waitForContent(session, "Claude CLI", 25000, 500);

  // Extra settle time for bars to render (metrics load may take a moment)
  await Bun.sleep(3000);

  // Final capture
  const { stdout: finalFrame } = await runTmux(["capture-pane", "-t", session, "-p"], {
    capture: true,
    suppressErrors: true,
  });

  const textFrame = finalFrame || frame;
  const invariants = extractStructuralInvariants(textFrame, width, height);

  // Kill the session
  await runTmux(["kill-session", "-t", session], { suppressErrors: true });

  return { width, height, textFrame, invariants };
}

/**
 * Capture golden masters at all standard resolutions and write to outputDir.
 * Returns a map of "WxH" -> CaptureResult.
 */
export async function captureGoldenFrames(
  tuiCommand: string,
  outputDir: string,
  resolutions: Array<{ width: number; height: number }> = [
    { width: 70, height: 35 },
    { width: 80, height: 24 },
    { width: 120, height: 40 },
    { width: 200, height: 60 },
  ],
): Promise<Map<string, CaptureResult>> {
  const results = new Map<string, CaptureResult>();

  for (const { width, height } of resolutions) {
    console.log(`  Capturing ${width}x${height}...`);
    try {
      const result = await captureAtResolution(width, height, tuiCommand);
      results.set(`${width}x${height}`, result);

      // Write text frame
      await Bun.write(`${outputDir}/${width}x${height}.txt`, result.textFrame);

      // Write structural invariants as JSON
      await Bun.write(`${outputDir}/${width}x${height}.json`, JSON.stringify(result.invariants, null, 2));

      console.log(
        `    hasClaude=${result.invariants.hasClaude} ` +
          `hasBars=${result.invariants.hasBars} ` +
          `markerLines=${result.invariants.markerLines.length} ` +
          `barLines=${result.invariants.barLines.length}`,
      );
    } catch (err) {
      console.error(`  Failed to capture ${width}x${height}: ${err}`);
    }
  }

  return results;
}
