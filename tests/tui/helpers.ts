/**
 * Test helpers for TUI component testing.
 * Provides mock data factories and testRender wrappers.
 */
import { testRender } from "@opentui/solid";
import type { MetricsDict } from "@lazyusage/core";
import type { ProjectUsage } from "@lazyusage/core/parsers/types.js";
import type { JSX } from "solid-js";

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

/** Create a mock Claude MetricsDict with configurable usage percentages. */
export function mockClaudeMetrics(
  overrides: {
    sessionPct?: number;
    weekAllPct?: number;
    weekSonnetPct?: number;
    subscriptionType?: string;
    resets?: string;
  } = {},
): MetricsDict {
  const resets = overrides.resets ?? "Feb 18 at 3:00am";
  return {
    subscription_type: overrides.subscriptionType ?? "max",
    session: {
      used_pct: overrides.sessionPct ?? 8,
      remaining_pct: 100 - (overrides.sessionPct ?? 8),
      resets,
    },
    week_all: {
      used_pct: overrides.weekAllPct ?? 50,
      remaining_pct: 100 - (overrides.weekAllPct ?? 50),
      resets: "Feb 18 at 11:00am",
    },
    week_sonnet: {
      used_pct: overrides.weekSonnetPct ?? 34,
      remaining_pct: 100 - (overrides.weekSonnetPct ?? 34),
      resets: "Feb 18 at 11:00am",
    },
  };
}

/** Create a mock Codex MetricsDict with configurable usage percentages. */
export function mockCodexMetrics(
  overrides: {
    fiveHourPct?: number;
    weeklyPct?: number;
    subscriptionType?: string;
    resets?: string;
  } = {},
): MetricsDict {
  const resets = overrides.resets ?? "Feb 18 at 4:00am";
  return {
    subscription_type: overrides.subscriptionType ?? "plus",
    "5h": {
      used_pct: overrides.fiveHourPct ?? 0,
      remaining_pct: 100 - (overrides.fiveHourPct ?? 0),
      resets,
    },
    weekly: {
      used_pct: overrides.weeklyPct ?? 4,
      remaining_pct: 100 - (overrides.weeklyPct ?? 4),
      resets: "Feb 23 at 9:59pm",
    },
  };
}

/** Create mock ProjectUsage[] data for ledger display. */
export function mockProjectUsage(
  projects: Array<{
    project: string;
    totalTokens: number;
    pctOfTotal?: number;
    inputTokens?: number;
    outputTokens?: number;
  }> = [],
): ProjectUsage[] {
  if (projects.length === 0) {
    return [
      {
        project: "my-app",
        totalTokens: 45000,
        pctOfTotal: 60.0,
        inputTokens: 30000,
        outputTokens: 15000,
      },
      {
        project: "other-project",
        totalTokens: 20000,
        pctOfTotal: 26.7,
        inputTokens: 15000,
        outputTokens: 5000,
      },
      {
        project: "small-script",
        totalTokens: 10000,
        pctOfTotal: 13.3,
        inputTokens: 7000,
        outputTokens: 3000,
      },
    ];
  }
  const total = projects.reduce((s, p) => s + p.totalTokens, 0);
  return projects.map((p) => ({
    project: p.project,
    totalTokens: p.totalTokens,
    pctOfTotal: p.pctOfTotal ?? (p.totalTokens / total) * 100,
    inputTokens: p.inputTokens ?? Math.floor(p.totalTokens * 0.7),
    outputTokens: p.outputTokens ?? Math.floor(p.totalTokens * 0.3),
  }));
}

// ---------------------------------------------------------------------------
// testRender wrappers
// ---------------------------------------------------------------------------

/** Default terminal dimensions for TUI tests. */
export const DEFAULT_WIDTH = 120;
export const DEFAULT_HEIGHT = 40;

/**
 * Render a component with test renderer at default 120x40 dimensions.
 * Calls renderOnce() so the component is fully initialized.
 */
export async function renderComponent(
  component: () => JSX.Element,
  options: { width?: number; height?: number } = {},
) {
  const { width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT } = options;
  const result = await testRender(component, { width, height });
  await result.renderOnce();
  return result;
}

// ---------------------------------------------------------------------------
// Color assertion helpers
// ---------------------------------------------------------------------------

/**
 * Convert a hex color string (e.g. "#a6e3a1") to [r, g, b] as 0-255 ints.
 * Handles both 6-char (#RRGGBB) and 3-char (#RGB) formats.
 */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/**
 * Find spans in a CapturedFrame whose text matches the given string.
 * Returns all matching spans across all lines.
 */
export function findSpansByText(
  frame: ReturnType<Awaited<ReturnType<typeof testRender>>["captureSpans"]>,
  searchText: string,
): Array<{ lineIndex: number; spanIndex: number; span: (typeof frame.lines)[0]["spans"][0] }> {
  const results: Array<{
    lineIndex: number;
    spanIndex: number;
    span: (typeof frame.lines)[0]["spans"][0];
  }> = [];
  for (let li = 0; li < frame.lines.length; li++) {
    const line = frame.lines[li];
    for (let si = 0; si < line.spans.length; si++) {
      if (line.spans[si].text.includes(searchText)) {
        results.push({ lineIndex: li, spanIndex: si, span: line.spans[si] });
      }
    }
  }
  return results;
}

/**
 * Assert that a span's foreground color approximately matches a hex color.
 * Uses tolerance of ±2 per channel to account for float precision.
 */
export function assertSpanFgColor(
  span: ReturnType<typeof findSpansByText>[0]["span"],
  expectedHex: string,
  label?: string,
): void {
  const [er, eg, eb] = hexToRgb(expectedHex);
  const [ar, ag, ab] = span.fg.toInts().slice(0, 3) as [number, number, number];
  const tolerance = 2;
  const mismatch =
    Math.abs(ar - er) > tolerance ||
    Math.abs(ag - eg) > tolerance ||
    Math.abs(ab - eb) > tolerance;
  if (mismatch) {
    throw new Error(
      `${label ?? "Span"} fg color mismatch: ` +
      `expected rgb(${er},${eg},${eb}) got rgb(${ar},${ag},${ab}) ` +
      `from hex ${expectedHex}`,
    );
  }
}
