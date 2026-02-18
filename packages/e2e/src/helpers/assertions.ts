/**
 * Frame validation assertions for E2E TUI tests.
 */
import { extractAllMarkers, extractBarWidths, validateEquidistant } from "./markers.js";

/** Assert the frame contains core structural markers. */
export function assertLayoutIntact(frame: string): void {
  if (!frame.includes("Claude CLI")) {
    throw new Error(`Layout broken: "Claude CLI" panel title missing from frame`);
  }
  if (!frame.includes("\u2502") && !frame.includes("\u256d")) {
    throw new Error(`Layout broken: no border characters found in frame`);
  }
}

/** Assert no line in the frame exceeds the expected width. */
export function assertNoTruncation(frame: string, width: number): void {
  const lines = frame.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > width) {
      throw new Error(
        `Line ${i} exceeds terminal width ${width}: length=${lines[i].length}`,
      );
    }
  }
}

/** Assert that the status bar is present in the frame. */
export function assertStatusBarPresent(frame: string): void {
  if (!frame.includes("Auto-refresh:")) {
    throw new Error(`Status bar missing: "Auto-refresh:" not found`);
  }
}

/** Assert metrics (bars) are visible for a given service. */
export function assertMetricsVisible(frame: string, service: "claude" | "codex"): void {
  const panelTitle = service === "claude" ? "Claude CLI" : "Codex CLI";
  if (!frame.includes(panelTitle)) {
    throw new Error(`Metrics not visible: panel title "${panelTitle}" missing`);
  }
  if (!frame.includes("\u2593") && !frame.includes("\u2591")) {
    throw new Error(`Metrics not visible: no bar chars (▓/░) found for ${service}`);
  }
}

/** Assert all time marker lines in the frame are equidistant. */
export function assertMarkersEquidistant(frame: string): void {
  const markerLines = extractAllMarkers(frame);
  if (markerLines.length === 0) return; // No markers = OK (small terminal)

  for (const ml of markerLines) {
    if (!ml.valid) {
      throw new Error(
        `Time markers not equidistant at line ${ml.lineIndex}: ` +
        `positions=[${ml.positions.join(",")}] gaps not equal`,
      );
    }
  }
}

/** Assert that bar widths are consistent across the frame. */
export function assertBarWidthsConsistent(frame: string): void {
  const barLines = extractBarWidths(frame);
  if (barLines.length < 2) return; // Not enough bars to compare

  const widths = barLines.map((b) => b.total);
  const firstWidth = widths[0];
  // All bars should have the same width (they all use the same barWidth calculation)
  for (const w of widths) {
    if (w !== firstWidth) {
      throw new Error(
        `Inconsistent bar widths: expected all bars to be ${firstWidth} chars wide, ` +
        `but found ${w}`,
      );
    }
  }
}

/** Assert the frame contains specific text content. */
export function assertContains(frame: string, text: string, context?: string): void {
  if (!frame.includes(text)) {
    const ctx = context ? ` (${context})` : "";
    throw new Error(`Frame missing expected content${ctx}: "${text}"`);
  }
}

/** Assert the frame does NOT contain specific text content. */
export function assertNotContains(frame: string, text: string, context?: string): void {
  if (frame.includes(text)) {
    const ctx = context ? ` (${context})` : "";
    throw new Error(`Frame unexpectedly contains${ctx}: "${text}"`);
  }
}

/** Assert the frame contains no crash indicators. */
export function assertNoCrash(frame: string): void {
  const crashIndicators = ["FATAL", "panic:", "Segmentation fault", "RuntimeError"];
  for (const indicator of crashIndicators) {
    if (frame.includes(indicator)) {
      throw new Error(`Crash indicator found: "${indicator}"`);
    }
  }
}
