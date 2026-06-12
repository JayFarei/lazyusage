import { describe, expect, test } from "bun:test";
import {
  calculateFallbackTime,
  calculateTimeProgress,
  format12hTime,
  formatResetDate,
  formatResetFromIso,
  formatTimeRemaining,
  parseTimeToDatetime,
} from "@lazyusage/core/utils/time.js";

describe("format12hTime", () => {
  test("converts 14:31 to 2:31pm", () => {
    expect(format12hTime(14, 31)).toBe("2:31pm");
  });

  test("converts 0:00 to 12:00am (midnight)", () => {
    expect(format12hTime(0, 0)).toBe("12:00am");
  });

  test("converts 12:00 to 12:00pm (noon)", () => {
    expect(format12hTime(12, 0)).toBe("12:00pm");
  });

  test("converts 1:05 to 1:05am", () => {
    expect(format12hTime(1, 5)).toBe("1:05am");
  });

  test("converts 23:59 to 11:59pm", () => {
    expect(format12hTime(23, 59)).toBe("11:59pm");
  });
});

describe("formatResetDate", () => {
  test("formats date with time", () => {
    const dt = new Date(2025, 1, 9, 20, 19); // Feb 9 at 8:19pm
    expect(formatResetDate(dt)).toBe("Feb 9 at 8:19pm");
  });

  test("formats midnight date", () => {
    const dt = new Date(2025, 0, 1, 0, 0); // Jan 1 at midnight
    expect(formatResetDate(dt)).toBe("Jan 1 at 12:00am");
  });
});

describe("parseTimeToDatetime", () => {
  test("parses simple time like 2:31pm", () => {
    const result = parseTimeToDatetime("2:31pm");
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(31);
  });

  test("parses hour-only time like 6pm", () => {
    const result = parseTimeToDatetime("6pm");
    expect(result.getHours()).toBe(18);
    expect(result.getMinutes()).toBe(0);
  });

  test("parses date+time like Feb 9 at 8:19pm", () => {
    const result = parseTimeToDatetime("Feb 9 at 8:19pm");
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(9);
    expect(result.getHours()).toBe(20);
    expect(result.getMinutes()).toBe(19);
  });

  test("parses date+hour like Feb 11 at 11am", () => {
    const result = parseTimeToDatetime("Feb 11 at 11am");
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(11);
    expect(result.getHours()).toBe(11);
    expect(result.getMinutes()).toBe(0);
  });

  test("returns now for unparseable input", () => {
    const before = Date.now();
    const result = parseTimeToDatetime("garbage");
    const after = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("formatTimeRemaining", () => {
  test("formats days and hours", () => {
    const now = new Date(2025, 0, 1, 10, 0);
    const reset = new Date(2025, 0, 3, 14, 0); // 2 days, 4 hours later
    expect(formatTimeRemaining(now, reset, 168)).toBe("2d 4h");
  });

  test("formats days only", () => {
    const now = new Date(2025, 0, 1, 10, 0);
    const reset = new Date(2025, 0, 3, 10, 0); // exactly 2 days
    expect(formatTimeRemaining(now, reset, 168)).toBe("2d");
  });

  test("formats hours and minutes", () => {
    const now = new Date(2025, 0, 1, 10, 0);
    const reset = new Date(2025, 0, 1, 13, 30); // 3h 30m
    expect(formatTimeRemaining(now, reset, 5)).toBe("3h 30m");
  });

  test("formats hours only", () => {
    const now = new Date(2025, 0, 1, 10, 0);
    const reset = new Date(2025, 0, 1, 13, 0); // exactly 3h
    expect(formatTimeRemaining(now, reset, 5)).toBe("3h");
  });

  test("formats minutes only", () => {
    const now = new Date(2025, 0, 1, 10, 0);
    const reset = new Date(2025, 0, 1, 10, 45); // 45m
    expect(formatTimeRemaining(now, reset, 5)).toBe("45m");
  });

  test("returns 0m when past reset", () => {
    const now = new Date(2025, 0, 1, 15, 0);
    const reset = new Date(2025, 0, 1, 10, 0); // in the past
    expect(formatTimeRemaining(now, reset, 5)).toBe("0m");
  });
});

describe("calculateTimeProgress", () => {
  test("returns 0 at window start", () => {
    // Create a reset time 5h from now, so we're at 0% progress
    const now = new Date();
    const reset = new Date(now.getTime() + 5 * 3600_000);
    const resetStr = format12hTime(reset.getHours(), reset.getMinutes());
    const progress = calculateTimeProgress(resetStr, 5);
    // We should be near 0% since reset is 5 hours away (window just started)
    expect(progress).toBeLessThan(5);
  });

  test("returns ~100 at window end", () => {
    // Create a reset time 1 minute from now so it stays in the future
    // (parseTimeToDatetime pushes past times to next day)
    const now = new Date();
    const soon = new Date(now.getTime() + 60_000);
    const resetStr = format12hTime(soon.getHours(), soon.getMinutes());
    const progress = calculateTimeProgress(resetStr, 5);
    // Should be near 100% since reset is ~1 minute away in a 5h window
    expect(progress).toBeGreaterThan(95);
  });

  test("clamps to 0-100 range", () => {
    const progress = calculateTimeProgress("11:59pm", 5);
    expect(progress).toBeGreaterThanOrEqual(0);
    expect(progress).toBeLessThanOrEqual(100);
  });
});

describe("calculateFallbackTime", () => {
  test("returns 12h format for same-day", () => {
    const result = calculateFallbackTime(5, true);
    // Should match pattern like "3:45pm"
    expect(result).toMatch(/^\d{1,2}:\d{2}(am|pm)$/);
  });

  test("returns date format for different day", () => {
    const result = calculateFallbackTime(5, false);
    // Should match pattern like "Feb 9 at 3:45pm"
    expect(result).toMatch(/^\w+ \d+ at \d{1,2}:\d{2}(am|pm)$/);
  });
});

describe("formatResetFromIso", () => {
  test("formats same-day ISO time", () => {
    const now = new Date();
    const iso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 30).toISOString();
    const result = formatResetFromIso(iso);
    expect(result).toBe("3:30pm");
  });

  test("formats different-day ISO time", () => {
    const future = new Date();
    future.setDate(future.getDate() + 3);
    future.setHours(14, 0, 0, 0);
    const iso = future.toISOString();
    const result = formatResetFromIso(iso);
    expect(result).toMatch(/^\w+ \d+ at 2:00pm$/);
  });

  test("returns fallback for empty string", () => {
    const result = formatResetFromIso("");
    expect(result).toMatch(/^\d{1,2}:\d{2}(am|pm)$/);
  });

  test("returns fallback for invalid ISO", () => {
    const result = formatResetFromIso("not-a-date");
    expect(result).toMatch(/^\d{1,2}:\d{2}(am|pm)$/);
  });
});
