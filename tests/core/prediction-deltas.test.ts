import { describe, expect, test } from "bun:test";
import { computeDailyDeltas, consumedFromSamples } from "../../packages/core/src/prediction/deltas.js";
import type { DailyBoundary } from "../../packages/core/src/types.js";

function boundary(overrides: Partial<DailyBoundary> = {}): DailyBoundary {
  return {
    date: "2026-03-20",
    firstUsedPct: 30,
    lastUsedPct: 45,
    consumedPct: 15,
    resetsAt: null,
    sampleCount: 50,
    ...overrides,
  };
}

describe("consumedFromSamples", () => {
  test("monotonic day: last - first", () => {
    expect(consumedFromSamples([30, 35, 45])).toBe(15);
  });

  test("empty and single sample consume nothing", () => {
    expect(consumedFromSamples([])).toBe(0);
    expect(consumedFromSamples([40])).toBe(0);
  });

  test("window reset mid-day: gains before and after the drop are summed", () => {
    // 80 -> 92 before the reset, 0 -> 16 after: 12 + 16, not 100 - 80 + 16
    expect(consumedFromSamples([80, 85, 92, 0, 5, 16])).toBe(28);
  });

  test("mid-window adjustment (real 2026-09-01 shape) counts real usage only", () => {
    // week_all: 42 -> 54, then usage zeroed by the provider, then 0 -> 10
    expect(consumedFromSamples([42, 43, 46, 48, 49, 54, 0, 2, 3, 4, 6, 10])).toBe(22);
    // week_sonnet on the same day
    expect(consumedFromSamples([66, 68, 73, 75, 76, 79, 0, 3, 4, 8, 9, 14])).toBe(27);
  });

  test("small dips are jitter and net out within the segment", () => {
    expect(consumedFromSamples([46, 45, 46])).toBe(0);
    expect(consumedFromSamples([50, 47, 52])).toBe(2);
  });

  test("a segment that ends below its start contributes nothing", () => {
    // 50 -> 48 (dip), then a reset to 0 -> 5: max(0, 48 - 50) + 5
    expect(consumedFromSamples([50, 48, 0, 5])).toBe(5);
  });

  test("capped day contributes zero", () => {
    expect(consumedFromSamples([100, 100, 100])).toBe(0);
  });

  test("multiple resets in one day are all counted", () => {
    expect(consumedFromSamples([90, 95, 0, 30, 0, 10])).toBe(45);
  });

  test("threshold is configurable", () => {
    expect(consumedFromSamples([10, 7, 12], 3)).toBe(5); // 3-point drop splits: (10-10) + (12-7)
    expect(consumedFromSamples([10, 7, 12], 5)).toBe(2); // absorbed as jitter
  });
});

describe("computeDailyDeltas", () => {
  test("normal day uses consumedPct", () => {
    const result = computeDailyDeltas([boundary()]);
    expect(result).toEqual([{ date: "2026-03-20", delta: 15, valid: true }]);
  });

  test("single-sample day is marked invalid", () => {
    const result = computeDailyDeltas([boundary({ date: "2026-03-14", consumedPct: 0, sampleCount: 1 })]);
    expect(result).toEqual([{ date: "2026-03-14", delta: 0, valid: false }]);
  });

  test("zero-sample day is marked invalid", () => {
    const result = computeDailyDeltas([boundary({ date: "2026-03-14", consumedPct: 0, sampleCount: 0 })]);
    expect(result).toEqual([{ date: "2026-03-14", delta: 0, valid: false }]);
  });

  test("reset day counts consumed usage, not the distance to 100", () => {
    const result = computeDailyDeltas([
      boundary({
        date: "2026-02-25",
        firstUsedPct: 80,
        lastUsedPct: 16,
        consumedPct: 28,
        resetsAt: "2026-02-25T14:00:00Z",
      }),
    ]);
    expect(result).toEqual([{ date: "2026-02-25", delta: 28, valid: true }]);
  });

  test("implausible consumption above 100% in a day is marked invalid", () => {
    const result = computeDailyDeltas([boundary({ date: "2026-03-06", consumedPct: 185, sampleCount: 200 })]);
    expect(result).toEqual([{ date: "2026-03-06", delta: 0, valid: false }]);
  });

  test("zero delta day is valid", () => {
    const result = computeDailyDeltas([
      boundary({ date: "2026-03-25", firstUsedPct: 47, lastUsedPct: 47, consumedPct: 0 }),
    ]);
    expect(result).toEqual([{ date: "2026-03-25", delta: 0, valid: true }]);
  });

  test("empty input returns empty array", () => {
    expect(computeDailyDeltas([])).toEqual([]);
  });

  test("multiple days processed in order", () => {
    const result = computeDailyDeltas([
      boundary({ date: "2026-03-20", consumedPct: 15 }),
      boundary({ date: "2026-03-21", firstUsedPct: 45, lastUsedPct: 49, consumedPct: 4, sampleCount: 30 }),
      boundary({ date: "2026-03-22", firstUsedPct: 50, lastUsedPct: 50, consumedPct: 0, sampleCount: 1 }),
    ]);
    expect(result).toEqual([
      { date: "2026-03-20", delta: 15, valid: true },
      { date: "2026-03-21", delta: 4, valid: true },
      { date: "2026-03-22", delta: 0, valid: false },
    ]);
  });
});
