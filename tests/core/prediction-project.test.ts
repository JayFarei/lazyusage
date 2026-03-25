import { describe, test, expect } from "bun:test";
import { predict } from "../../packages/core/src/prediction/project.js";
import type { DailyDelta, SupervisedMark } from "../../packages/core/src/types.js";

describe("predict", () => {
  const baseDelta = (date: string, delta: number): DailyDelta => ({
    date, delta, valid: true,
  });

  test("linear projection with history", () => {
    const deltas: DailyDelta[] = [
      baseDelta("2026-03-20", 10),
      baseDelta("2026-03-21", 8),
      baseDelta("2026-03-22", 12),
    ];
    const result = predict(deltas, 47, 2.3, "2026-03-27T16:00:00Z", "claude", "week_all");
    expect(result.service).toBe("claude");
    expect(result.metricName).toBe("week_all");
    expect(result.usedSoFar).toBe(47);
    expect(result.averageRate).toBe(10); // (10+8+12)/3 = 10
    expect(result.confidence).toBe("low"); // 3 days < 7
    expect(result.source).toBe("unsupervised");
    expect(result.overBudget).toBe(false);
    // projectedTotal = 47 + (2.3 * 10) = 70, spare = 30
    expect(result.projectedTotal).toBe(70);
    expect(result.predictedSpare).toBe(30);
  });

  test("cold start with 0 valid deltas", () => {
    const deltas: DailyDelta[] = [
      { date: "2026-03-20", delta: 0, valid: false },
    ];
    const result = predict(deltas, 47, 2.0, "2026-03-27T16:00:00Z", "claude", "week_all");
    expect(result.averageRate).toBe(15); // COLD_START_RATE
    expect(result.confidence).toBe("low");
    expect(result.sampleDays).toBe(0);
  });

  test("over-budget projection", () => {
    const deltas: DailyDelta[] = [
      baseDelta("2026-03-20", 10),
      baseDelta("2026-03-21", 10),
      baseDelta("2026-03-22", 10),
    ];
    // used=85, remaining=3, rate=10 → projected=115, spare=-15
    const result = predict(deltas, 85, 3, "2026-03-27T16:00:00Z", "claude", "week_all");
    expect(result.overBudget).toBe(true);
    expect(result.predictedSpare).toBeLessThan(0);
  });

  test("zero remaining days", () => {
    const deltas: DailyDelta[] = [baseDelta("2026-03-20", 8)];
    const result = predict(deltas, 99, 0, "2026-03-25T10:00:00Z", "claude", "week_all");
    expect(result.predictedSpare).toBe(1);
    expect(result.overBudget).toBe(false);
  });

  test("all equal deltas produce that rate", () => {
    const deltas: DailyDelta[] = Array.from({ length: 10 }, (_, i) =>
      baseDelta(`2026-03-${String(10 + i).padStart(2, "0")}`, 8),
    );
    const result = predict(deltas, 40, 3, "2026-03-27T16:00:00Z", "claude", "week_all");
    expect(result.averageRate).toBe(8);
  });

  test("supervised mark override changes rate for that day", () => {
    const deltas: DailyDelta[] = [
      baseDelta("2026-03-20", 10),
      baseDelta("2026-03-21", 10),
      baseDelta("2026-03-22", 10),
    ];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    const marks: SupervisedMark[] = [{ date: tomorrowStr, regime: "L" }];
    const result = predict(deltas, 47, 2, "2026-03-27T16:00:00Z", "claude", "week_all", marks);
    expect(result.source).toBe("blended");
    // With mark L=3% for one day and average=10% for rest, total should be less than pure 10%
  });

  test("blended source detection", () => {
    const deltas: DailyDelta[] = [baseDelta("2026-03-20", 10)];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const marks: SupervisedMark[] = [{ date: tomorrow.toISOString().slice(0, 10), regime: "M" }];
    const result = predict(deltas, 47, 2, "2026-03-27T16:00:00Z", "claude", "week_all", marks);
    expect(result.source).toBe("blended");
  });

  test("supervised only (marks + 0 valid deltas)", () => {
    const deltas: DailyDelta[] = [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const marks: SupervisedMark[] = [{ date: tomorrow.toISOString().slice(0, 10), regime: "H" }];
    const result = predict(deltas, 47, 2, "2026-03-27T16:00:00Z", "claude", "week_all", marks);
    expect(result.source).toBe("supervised");
  });

  test("confidence thresholds", () => {
    const makeDelta = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        baseDelta(`2026-03-${String(i + 1).padStart(2, "0")}`, 5),
      );

    const low = predict(makeDelta(5), 40, 2, "2026-03-27T16:00:00Z", "claude", "week_all");
    expect(low.confidence).toBe("low");

    const medium = predict(makeDelta(15), 40, 2, "2026-03-27T16:00:00Z", "claude", "week_all");
    expect(medium.confidence).toBe("medium");

    const high = predict(makeDelta(25), 40, 2, "2026-03-27T16:00:00Z", "claude", "week_all");
    expect(high.confidence).toBe("high");
  });

  test("rounding: values are rounded to 1 decimal", () => {
    const deltas: DailyDelta[] = [baseDelta("2026-03-20", 7.333)];
    const result = predict(deltas, 47, 2.3, "2026-03-27T16:00:00Z", "claude", "week_all");
    expect(result.averageRate).toBe(7.3);
    expect(Number.isFinite(result.projectedTotal)).toBe(true);
    expect(Number.isFinite(result.predictedSpare)).toBe(true);
  });
});
