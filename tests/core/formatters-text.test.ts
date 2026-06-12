import { describe, expect, test } from "bun:test";
import { formatClaudeText, formatCodexText, formatWithAvailability, type MetricsDict } from "lazyusage-core";

describe("formatClaudeText", () => {
  test("formats claude metrics correctly", () => {
    const metrics: MetricsDict = {
      subscription_type: "Max",
      session: { used_pct: 25, remaining_pct: 75, resets: "2:31pm" },
      week_all: { used_pct: 15, remaining_pct: 85, resets: "Feb 9 at 8:19pm" },
      week_sonnet: { used_pct: 10, remaining_pct: 90, resets: "Feb 9 at 8:19pm" },
    };
    const result = formatClaudeText(metrics);
    expect(result).toContain("Session: 25% allowance used");
    expect(result).toContain("capacity remaining");
    expect(result).toContain("resets 2:31pm");
    expect(result).toContain("[Subscription: Max]");
  });

  test("formats without subscription type", () => {
    const metrics: MetricsDict = {
      subscription_type: null,
      session: { used_pct: 0, remaining_pct: 100, resets: "5:00pm" },
      week_all: { used_pct: 0, remaining_pct: 100, resets: "Feb 12 at 5:00pm" },
      week_sonnet: { used_pct: 0, remaining_pct: 100, resets: "Feb 12 at 5:00pm" },
    };
    const result = formatClaudeText(metrics);
    expect(result).not.toContain("[Subscription:");
    expect(result).toContain("Session: 0% allowance used");
  });

  test("includes weekly and sonnet metrics", () => {
    const metrics: MetricsDict = {
      subscription_type: "Pro",
      session: { used_pct: 50, remaining_pct: 50, resets: "3:00pm" },
      week_all: { used_pct: 30, remaining_pct: 70, resets: "Feb 15 at 1:00pm" },
      week_sonnet: { used_pct: 20, remaining_pct: 80, resets: "Feb 15 at 1:00pm" },
    };
    const result = formatClaudeText(metrics);
    expect(result).toContain("Weekly: 30% allowance used");
    expect(result).toContain("Sonnet: 20% allowance used");
  });

  test("uses pipe separator between metrics", () => {
    const metrics: MetricsDict = {
      subscription_type: null,
      session: { used_pct: 10, remaining_pct: 90, resets: "1:00pm" },
      week_all: { used_pct: 5, remaining_pct: 95, resets: "Feb 10 at 1:00pm" },
      week_sonnet: { used_pct: 3, remaining_pct: 97, resets: "Feb 10 at 1:00pm" },
    };
    const result = formatClaudeText(metrics);
    expect(result).toContain(" | ");
  });

  test("rounds fractional percentages", () => {
    const metrics: MetricsDict = {
      subscription_type: null,
      session: { used_pct: 25.7, remaining_pct: 74.3, resets: "3:00pm" },
      week_all: { used_pct: 15.3, remaining_pct: 84.7, resets: "Feb 10 at 3:00pm" },
      week_sonnet: { used_pct: 10.9, remaining_pct: 89.1, resets: "Feb 10 at 3:00pm" },
    };
    const result = formatClaudeText(metrics);
    expect(result).toContain("Session: 26% allowance used");
    expect(result).toContain("Weekly: 15% allowance used");
    expect(result).toContain("Sonnet: 11% allowance used");
  });
});

describe("formatCodexText", () => {
  test("formats codex metrics with Session label", () => {
    const metrics: MetricsDict = {
      subscription_type: "Plus",
      "5h": { used_pct: 20, remaining_pct: 80, resets: "3:15pm" },
      weekly: { used_pct: 12, remaining_pct: 88, resets: "Feb 10 at 9:00pm" },
    };
    const result = formatCodexText(metrics);
    expect(result).toContain("Session: 20% allowance used");
    expect(result).toContain("capacity remaining");
    expect(result).toContain("[Subscription: Plus]");
  });

  test("formats without subscription type", () => {
    const metrics: MetricsDict = {
      subscription_type: null,
      "5h": { used_pct: 0, remaining_pct: 100, resets: "6:00pm" },
      weekly: { used_pct: 0, remaining_pct: 100, resets: "Feb 14 at 6:00pm" },
    };
    const result = formatCodexText(metrics);
    expect(result).not.toContain("[Subscription:");
    expect(result).toContain("Session: 0% allowance used");
  });

  test("includes weekly metrics", () => {
    const metrics: MetricsDict = {
      subscription_type: null,
      "5h": { used_pct: 40, remaining_pct: 60, resets: "4:00pm" },
      weekly: { used_pct: 25, remaining_pct: 75, resets: "Feb 12 at 4:00pm" },
    };
    const result = formatCodexText(metrics);
    expect(result).toContain("Weekly: 25% allowance used");
  });
});

describe("formatWithAvailability", () => {
  test("shows not available when service missing", () => {
    const result = formatWithAvailability(null, null, []);
    expect(result).toContain("Claude: [not available]");
    expect(result).toContain("Codex: [not available]");
  });

  test("shows metrics for available services", () => {
    const claudeMetrics: MetricsDict = {
      subscription_type: "Max",
      session: { used_pct: 25, remaining_pct: 75, resets: "2:31pm" },
      week_all: { used_pct: 15, remaining_pct: 85, resets: "Feb 9 at 8:19pm" },
      week_sonnet: { used_pct: 10, remaining_pct: 90, resets: "Feb 9 at 8:19pm" },
    };
    const result = formatWithAvailability(claudeMetrics, null, ["claude"]);
    expect(result).toContain("Claude: Session: 25% allowance used");
    expect(result).toContain("Codex: [not available]");
  });
});
