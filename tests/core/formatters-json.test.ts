import { describe, test, expect } from "bun:test";
import {
  formatJson,
  formatAllJson,
  formatCombinedJson,
  type MetricsDict,
} from "@lazyusage/core";

describe("formatJson", () => {
  test("outputs valid JSON", () => {
    const metrics: MetricsDict = {
      subscription_type: "Max",
      session: { used_pct: 25, remaining_pct: 75, resets: "2:31pm" },
      week_all: { used_pct: 15, remaining_pct: 85, resets: "Feb 9 at 8:19pm" },
      week_sonnet: { used_pct: 10, remaining_pct: 90, resets: "Feb 9 at 8:19pm" },
    };
    const result = formatJson("claude", metrics);
    const parsed = JSON.parse(result);
    expect(parsed.service).toBe("claude");
    expect(Array.isArray(parsed.metrics)).toBe(true);
  });

  test("includes timestamp", () => {
    const metrics: MetricsDict = {
      subscription_type: null,
      session: { used_pct: 0, remaining_pct: 100, resets: "5:00pm" },
    };
    const result = formatJson("claude", metrics);
    const parsed = JSON.parse(result);
    expect(parsed.timestamp).toBeDefined();
    expect(typeof parsed.timestamp).toBe("string");
  });

  test("includes subscription type", () => {
    const metrics: MetricsDict = {
      subscription_type: "Max",
      session: { used_pct: 25, remaining_pct: 75, resets: "2:31pm" },
    };
    const result = formatJson("claude", metrics);
    const parsed = JSON.parse(result);
    expect(parsed.subscription_type).toBe("Max");
  });

  test("handles null subscription type", () => {
    const metrics: MetricsDict = {
      subscription_type: null,
      session: { used_pct: 0, remaining_pct: 100, resets: "5:00pm" },
    };
    const result = formatJson("claude", metrics);
    const parsed = JSON.parse(result);
    expect(parsed.subscription_type).toBeNull();
  });

  test("metric entries have correct shape", () => {
    const metrics: MetricsDict = {
      subscription_type: "Pro",
      session: { used_pct: 50, remaining_pct: 50, resets: "3:00pm" },
      week_all: { used_pct: 30, remaining_pct: 70, resets: "Feb 15 at 1:00pm" },
    };
    const result = formatJson("claude", metrics);
    const parsed = JSON.parse(result);
    expect(parsed.metrics).toHaveLength(2);
    const sessionMetric = parsed.metrics.find((m: Record<string, unknown>) => m.name === "session");
    expect(sessionMetric).toBeDefined();
    expect(sessionMetric.used_pct).toBe(50);
    expect(sessionMetric.remaining_pct).toBe(50);
    expect(sessionMetric.resets).toBe("3:00pm");
  });

  test("skips subscription_type from metrics array", () => {
    const metrics: MetricsDict = {
      subscription_type: "Max",
      session: { used_pct: 25, remaining_pct: 75, resets: "2:31pm" },
    };
    const result = formatJson("claude", metrics);
    const parsed = JSON.parse(result);
    const names = parsed.metrics.map((m: Record<string, unknown>) => m.name);
    expect(names).not.toContain("subscription_type");
  });
});

describe("formatAllJson", () => {
  test("includes both services", () => {
    const claudeMetrics: MetricsDict = {
      subscription_type: "Max",
      session: { used_pct: 25, remaining_pct: 75, resets: "2:31pm" },
      week_all: { used_pct: 15, remaining_pct: 85, resets: "Feb 9 at 8:19pm" },
      week_sonnet: { used_pct: 10, remaining_pct: 90, resets: "Feb 9 at 8:19pm" },
    };
    const codexMetrics: MetricsDict = {
      subscription_type: "Plus",
      "5h": { used_pct: 20, remaining_pct: 80, resets: "3:15pm" },
      weekly: { used_pct: 12, remaining_pct: 88, resets: "Feb 10 at 9:00pm" },
    };
    const result = formatAllJson(claudeMetrics, codexMetrics);
    const parsed = JSON.parse(result);
    expect(parsed.services).toBeDefined();
    expect(parsed.services.claude).toBeDefined();
    expect(parsed.services.codex).toBeDefined();
    expect(parsed.timestamp).toBeDefined();
  });

  test("claude service has correct metrics", () => {
    const claudeMetrics: MetricsDict = {
      subscription_type: "Max",
      session: { used_pct: 25, remaining_pct: 75, resets: "2:31pm" },
    };
    const codexMetrics: MetricsDict = {
      subscription_type: null,
      "5h": { used_pct: 0, remaining_pct: 100, resets: "5:00pm" },
    };
    const result = formatAllJson(claudeMetrics, codexMetrics);
    const parsed = JSON.parse(result);
    expect(parsed.services.claude.subscription_type).toBe("Max");
    expect(parsed.services.claude.metrics).toHaveLength(1);
  });
});

describe("formatCombinedJson", () => {
  test("includes availability metadata", () => {
    const result = formatCombinedJson(null, null, ["claude"]);
    const parsed = JSON.parse(result);
    expect(parsed.available_services).toContain("claude");
    expect(Array.isArray(parsed.services)).toBe(true);
    expect(parsed.services).toHaveLength(2);
  });

  test("marks services as available/unavailable", () => {
    const result = formatCombinedJson(null, null, ["claude"]);
    const parsed = JSON.parse(result);
    const claudeSvc = parsed.services.find((s: Record<string, unknown>) => s.name === "claude");
    const codexSvc = parsed.services.find((s: Record<string, unknown>) => s.name === "codex");
    expect(claudeSvc.available).toBe(true);
    expect(codexSvc.available).toBe(false);
  });

  test("includes metrics when provided", () => {
    const claudeMetrics: MetricsDict = {
      subscription_type: "Max",
      session: { used_pct: 25, remaining_pct: 75, resets: "2:31pm" },
    };
    const result = formatCombinedJson(claudeMetrics, null, ["claude"]);
    const parsed = JSON.parse(result);
    const claudeSvc = parsed.services.find((s: Record<string, unknown>) => s.name === "claude");
    expect(claudeSvc.metrics).toHaveLength(1);
    expect(claudeSvc.subscription_type).toBe("Max");
  });

  test("includes resource-awareness metadata when provided", () => {
    const claudeMetrics: MetricsDict = {
      subscription_type: "Max",
      session: { used_pct: 25, remaining_pct: 75, resets: "2:31pm" },
    };
    const result = formatCombinedJson(
      claudeMetrics,
      null,
      ["claude"],
      undefined,
      {
        claude: {
          source: "cache" as never,
          stale: true,
          error: "API unavailable",
        },
      },
    );
    const parsed = JSON.parse(result);
    const claudeSvc = parsed.services.find((s: Record<string, unknown>) => s.name === "claude");
    expect(claudeSvc.source).toBe("cache");
    expect(claudeSvc.stale).toBe(true);
    expect(claudeSvc.error).toBe("API unavailable");
  });

  test("handles null metrics gracefully", () => {
    const result = formatCombinedJson(null, null, []);
    const parsed = JSON.parse(result);
    expect(parsed.available_services).toEqual([]);
    for (const svc of parsed.services) {
      expect(svc.metrics).toEqual([]);
      expect(svc.subscription_type).toBeNull();
      expect(svc.stale).toBe(false);
      expect(svc.error).toBeNull();
    }
  });

  test("includes timestamp", () => {
    const result = formatCombinedJson(null, null, []);
    const parsed = JSON.parse(result);
    expect(parsed.timestamp).toBeDefined();
    expect(typeof parsed.timestamp).toBe("string");
  });
});
