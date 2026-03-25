import { describe, test, expect } from "bun:test";
import { createPredictionBar } from "../../packages/core/src/utils/bars.js";

describe("createPredictionBar", () => {
  test("normal 3-segment bar sums to barWidth", () => {
    const segments = createPredictionBar(47, 23, 35);
    const total = segments.used.length + segments.predicted.length + segments.spare.length;
    expect(total).toBe(35);
  });

  test("all used (100%)", () => {
    const segments = createPredictionBar(100, 0, 35);
    expect(segments.used.length).toBe(35);
    expect(segments.predicted.length).toBe(0);
    expect(segments.spare.length).toBe(0);
  });

  test("nothing used (0%)", () => {
    const segments = createPredictionBar(0, 30, 35);
    expect(segments.used.length).toBe(0);
    expect(segments.predicted.length).toBeGreaterThan(0);
    expect(segments.spare.length).toBeGreaterThan(0);
  });

  test("over-budget: used + predicted > 100, spare clamped to 0", () => {
    const segments = createPredictionBar(85, 25, 35);
    expect(segments.spare.length).toBe(0);
    const total = segments.used.length + segments.predicted.length + segments.spare.length;
    expect(total).toBe(35);
  });

  test("rounding alignment: segments always sum to barWidth", () => {
    // Test with values that cause rounding issues
    for (const width of [35, 70, 105]) {
      for (const used of [33.3, 33.33, 50, 66.67]) {
        for (const pred of [10, 20, 33.3]) {
          const segments = createPredictionBar(used, pred, width);
          const total = segments.used.length + segments.predicted.length + segments.spare.length;
          expect(total).toBe(width);
        }
      }
    }
  });

  test("MIN_BAR_WIDTH edge: no negative segment lengths", () => {
    const segments = createPredictionBar(1, 1, 35);
    expect(segments.used.length).toBeGreaterThanOrEqual(0);
    expect(segments.predicted.length).toBeGreaterThanOrEqual(0);
    expect(segments.spare.length).toBeGreaterThanOrEqual(0);
  });

  test("uses correct Unicode characters", () => {
    const segments = createPredictionBar(50, 25, 10);
    // ▓ = U+2593 (used), ▒ = U+2592 (predicted), ░ = U+2591 (spare)
    expect(segments.used).toMatch(/^[\u2593]*$/);
    expect(segments.predicted).toMatch(/^[\u2592]*$/);
    expect(segments.spare).toMatch(/^[\u2591]*$/);
  });
});
