import { describe, expect, test } from "bun:test";
import {
  buildPaceData,
  createBrailleCanvas,
  createTimeAxisTicks,
  formatResetDate,
  renderUsageChart,
} from "../../packages/core/src/index.js";
import type { UsageStore } from "../../packages/core/src/storage/database.js";

describe("chart rendering", () => {
  test("maps braille pixels into the expected unicode cell", () => {
    const canvas = createBrailleCanvas(1, 1);

    canvas.setPixel(0, 0);
    expect(canvas.toRows()).toEqual(["⠁"]);

    canvas.clear();
    for (let x = 0; x < 2; x += 1) {
      for (let y = 0; y < 4; y += 1) {
        canvas.setPixel(x, y);
      }
    }

    expect(canvas.toRows()).toEqual(["⣿"]);
  });

  test("builds current-window pace data and appends the live point", () => {
    const nowMs = Date.now();
    const resetLabel = formatResetDate(new Date(nowMs + 5 * 3600_000));
    const store: Pick<UsageStore, "getHistory"> = {
      getHistory: () => [
        {
          timestamp: new Date(nowMs - 120 * 60_000).toISOString(),
          used_pct: 18,
        },
        {
          timestamp: new Date(nowMs - 40 * 60_000).toISOString(),
          used_pct: 44,
        },
      ],
    };

    const data = buildPaceData(store, "claude", "session", {
      nowMs,
      currentMetric: {
        used_pct: 52,
        remaining_pct: 48,
        resets: resetLabel,
      },
    });

    expect(data.points.at(-1)?.usedPct).toBe(52);
    expect(data.windowEndMs).toBeGreaterThan(nowMs);
    expect(data.projectedTotalPct).toBeGreaterThan(52);
  });

  test("renders a usage chart with axes, prediction, and a live marker", () => {
    const startMs = Date.now() - 5 * 3600_000;
    const endMs = startMs + 5 * 3600_000;
    const chart = renderUsageChart({
      points: [
        { timestampMs: startMs, value: 0 },
        { timestampMs: startMs + 90 * 60_000, value: 18 },
        { timestampMs: startMs + 180 * 60_000, value: 43 },
        { timestampMs: startMs + 260 * 60_000, value: 57 },
      ],
      widthCells: 28,
      heightCells: 8,
      windowStartMs: startMs,
      windowEndMs: endMs,
      nowMs: startMs + 270 * 60_000,
      yMaxPct: 130,
      projectedTotalPct: 122,
      xTicks: createTimeAxisTicks("session", startMs),
    });

    const output = chart.lines.join("\n");

    expect(output).toContain("130%");
    expect(output).toContain("100%");
    expect(output).toContain("0h");
    expect(output).toContain("│");
    expect(output).toContain("┈");
    expect(output).toContain("◆");
    expect(output).toMatch(/[\u2801-\u28ff]/u);
  });
});
