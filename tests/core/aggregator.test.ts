/**
 * Tests for aggregateDaily, aggregateWeekly, aggregateMonthly.
 * Uses fixed date strings to avoid test sensitivity to current date.
 */
import { describe, test, expect } from "bun:test";
import {
  aggregateDaily,
  aggregateWeekly,
  aggregateMonthly,
} from "@lazyusage/core/parsers/aggregator.js";
import type { SessionTokens } from "@lazyusage/core/parsers/types";

/** Get today, N days ago, as YYYY-MM-DD local strings */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function makeSession(overrides: Partial<SessionTokens> = {}): SessionTokens {
  return {
    project: "my-project",
    cwd: "/home/user/my-project",
    service: "claude",
    date: todayStr(),
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    ...overrides,
  };
}

describe("aggregateDaily", () => {
  test("returns empty array for empty input", () => {
    expect(aggregateDaily([])).toEqual([]);
  });

  test("includes only today's sessions", () => {
    const sessions = [
      makeSession({ date: todayStr(), totalTokens: 1000 }),
      makeSession({ date: daysAgoStr(1), totalTokens: 9999 }), // yesterday
      makeSession({ date: daysAgoStr(7), totalTokens: 9999 }), // last week
    ];
    const result = aggregateDaily(sessions);
    expect(result).toHaveLength(1);
    expect(result[0].totalTokens).toBe(1000);
  });

  test("groups sessions by project and sums tokens", () => {
    const sessions = [
      makeSession({ project: "app-a", totalTokens: 1000, inputTokens: 800, outputTokens: 200, date: todayStr() }),
      makeSession({ project: "app-a", totalTokens: 500, inputTokens: 400, outputTokens: 100, date: todayStr() }),
      makeSession({ project: "app-b", totalTokens: 200, inputTokens: 150, outputTokens: 50, date: todayStr() }),
    ];
    const result = aggregateDaily(sessions);
    expect(result).toHaveLength(2);
    const appA = result.find((r) => r.project === "app-a")!;
    expect(appA.totalTokens).toBe(1500);
    expect(appA.inputTokens).toBe(1200);
    expect(appA.outputTokens).toBe(300);
  });

  test("sorts by totalTokens descending", () => {
    const sessions = [
      makeSession({ project: "small", totalTokens: 100, date: todayStr() }),
      makeSession({ project: "large", totalTokens: 5000, date: todayStr() }),
      makeSession({ project: "medium", totalTokens: 1000, date: todayStr() }),
    ];
    const result = aggregateDaily(sessions);
    expect(result[0].project).toBe("large");
    expect(result[1].project).toBe("medium");
    expect(result[2].project).toBe("small");
  });

  test("pctOfTotal is correct for single project (100%)", () => {
    const sessions = [makeSession({ totalTokens: 1000, date: todayStr() })];
    const result = aggregateDaily(sessions);
    expect(result[0].pctOfTotal).toBeCloseTo(100, 1);
  });

  test("pctOfTotal distributes correctly across projects", () => {
    const sessions = [
      makeSession({ project: "big", totalTokens: 7500, date: todayStr() }),
      makeSession({ project: "small", totalTokens: 2500, date: todayStr() }),
    ];
    const result = aggregateDaily(sessions);
    const big = result.find((r) => r.project === "big")!;
    const small = result.find((r) => r.project === "small")!;
    expect(big.pctOfTotal).toBeCloseTo(75, 1);
    expect(small.pctOfTotal).toBeCloseTo(25, 1);
  });
});

describe("aggregateWeekly", () => {
  test("includes sessions from 7 days ago through today", () => {
    const sessions = [
      makeSession({ date: todayStr(), totalTokens: 100 }),
      makeSession({ date: daysAgoStr(3), totalTokens: 200 }),
      makeSession({ date: daysAgoStr(7), totalTokens: 300 }),
      makeSession({ date: daysAgoStr(8), totalTokens: 9999 }), // outside window
    ];
    const result = aggregateWeekly(sessions);
    const total = result.reduce((s, r) => s + r.totalTokens, 0);
    expect(total).toBe(600); // 100 + 200 + 300 (not 9999)
  });

  test("returns empty for no sessions in window", () => {
    const sessions = [
      makeSession({ date: daysAgoStr(30), totalTokens: 100 }),
    ];
    const result = aggregateWeekly(sessions);
    expect(result).toHaveLength(0);
  });
});

describe("aggregateMonthly", () => {
  test("includes sessions from 28 days ago through today", () => {
    const sessions = [
      makeSession({ date: todayStr(), totalTokens: 100 }),
      makeSession({ date: daysAgoStr(14), totalTokens: 200 }),
      makeSession({ date: daysAgoStr(28), totalTokens: 300 }),
      makeSession({ date: daysAgoStr(29), totalTokens: 9999 }), // outside window
    ];
    const result = aggregateMonthly(sessions);
    const total = result.reduce((s, r) => s + r.totalTokens, 0);
    expect(total).toBe(600);
  });

  test("returns empty for empty input", () => {
    expect(aggregateMonthly([])).toEqual([]);
  });
});
