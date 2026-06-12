import { describe, expect, test } from "bun:test";
import {
  calculateBarWidth,
  createCapacityBar,
  createPeriodBar,
  createTimeMarkers,
  MAX_BAR_WIDTH,
  MIN_BAR_WIDTH,
} from "lazyusage-core/utils/bars.js";

describe("calculateBarWidth", () => {
  test("snaps to 35 multiples", () => {
    // 100 - 10 = 90, floor(90/35)*35 = 70
    expect(calculateBarWidth(100, 10)).toBe(70);
  });

  test("clamps to minimum bar width", () => {
    // 40 - 30 = 10, snapped to 0, clamped to MIN_BAR_WIDTH
    expect(calculateBarWidth(40, 30)).toBe(MIN_BAR_WIDTH);
  });

  test("clamps to maximum bar width", () => {
    // 500 - 10 = 490, snapped to 490/35*35 = 14*35 = 490, but capped at 315
    expect(calculateBarWidth(500, 10)).toBe(MAX_BAR_WIDTH);
  });

  test("exact multiple passes through", () => {
    // 80 - 10 = 70, exactly 2*35 = 70
    expect(calculateBarWidth(80, 10)).toBe(70);
  });

  test("negative raw width clamps to minimum", () => {
    expect(calculateBarWidth(5, 20)).toBe(MIN_BAR_WIDTH);
  });
});

describe("createTimeMarkers", () => {
  test("returns spaces for 1 division", () => {
    const result = createTimeMarkers(1, 35);
    expect(result).toBe(" ".repeat(35));
    expect(result.length).toBe(35);
  });

  test("creates markers for 5 divisions", () => {
    const barWidth = 35;
    const result = createTimeMarkers(5, barWidth);
    expect(result.length).toBe(barWidth);
    // With 5 divisions and width 35, segment = 7
    // Markers at positions 7, 14, 21, 28
    const markerPositions: number[] = [];
    for (let i = 0; i < result.length; i++) {
      if (result[i] === "\u2503") markerPositions.push(i);
    }
    expect(markerPositions).toEqual([7, 14, 21, 28]);
  });

  test("creates markers for 7 divisions", () => {
    const barWidth = 70;
    const result = createTimeMarkers(7, barWidth);
    expect(result.length).toBe(barWidth);
    // segment = 10, markers at 10, 20, 30, 40, 50, 60
    const markerPositions: number[] = [];
    for (let i = 0; i < result.length; i++) {
      if (result[i] === "\u2503") markerPositions.push(i);
    }
    expect(markerPositions).toEqual([10, 20, 30, 40, 50, 60]);
  });
});

describe("createCapacityBar", () => {
  test("0% returns all light blocks", () => {
    const result = createCapacityBar(0, 35);
    expect(result).toBe("\u2591".repeat(35));
  });

  test("100% returns all dark blocks", () => {
    const result = createCapacityBar(100, 35);
    expect(result).toBe("\u2593".repeat(35));
  });

  test("50% returns half and half", () => {
    const barWidth = 20;
    const result = createCapacityBar(50, barWidth);
    expect(result.length).toBe(barWidth);
    const filled = result.split("").filter((c) => c === "\u2593").length;
    const empty = result.split("").filter((c) => c === "\u2591").length;
    expect(filled).toBe(10);
    expect(empty).toBe(10);
  });

  test("uses Math.round for capacity", () => {
    // 33% of 10 = 3.3, rounds to 3
    const result = createCapacityBar(33, 10);
    const filled = result.split("").filter((c) => c === "\u2593").length;
    expect(filled).toBe(3);
  });
});

describe("createPeriodBar", () => {
  test("0% returns all light blocks", () => {
    const result = createPeriodBar(0, 35);
    expect(result).toBe("\u2591".repeat(35));
  });

  test("100% returns all dark blocks", () => {
    const result = createPeriodBar(100, 35);
    expect(result).toBe("\u2593".repeat(35));
  });

  test("uses Math.floor for period", () => {
    // 33% of 10 = 3.3, floors to 3
    const result = createPeriodBar(33, 10);
    const filled = result.split("").filter((c) => c === "\u2593").length;
    expect(filled).toBe(3);
  });
});
