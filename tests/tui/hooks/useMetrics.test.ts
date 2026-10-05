/**
 * Tests for useMetrics hook.
 */
import { describe, expect, test } from "bun:test";
import { DataSource } from "lazyusage-core";
import { createRoot } from "solid-js";
import { useMetrics } from "../../../packages/cli/src/tui/hooks/useMetrics.js";
import { mockClaudeMetrics, mockCodexMetrics } from "../helpers.js";

describe("useMetrics - updateMetrics for claude", () => {
  test("sets claude metrics on success", () => {
    createRoot((dispose) => {
      const { metricsFor, updateMetrics } = useMetrics();
      expect(metricsFor("claude")).toBeNull();
      const metrics = mockClaudeMetrics();
      updateMetrics("claude", metrics, null, "api");
      expect(metricsFor("claude")).toEqual(metrics);
      dispose();
    });
  });

  test("clears claude metrics and sets error on failure", () => {
    createRoot((dispose) => {
      const { metricsFor, errorFor, updateMetrics } = useMetrics();
      // Set metrics first
      updateMetrics("claude", mockClaudeMetrics(), null, "api");
      expect(metricsFor("claude")).not.toBeNull();
      // Now fail
      updateMetrics("claude", null, "connection failed", "fallback");
      expect(metricsFor("claude")).toBeNull();
      expect(errorFor("claude")).toBe("connection failed");
      dispose();
    });
  });

  test("clears claude error on subsequent success", () => {
    createRoot((dispose) => {
      const { errorFor, updateMetrics } = useMetrics();
      updateMetrics("claude", null, "error", "fallback");
      expect(errorFor("claude")).toBe("error");
      updateMetrics("claude", mockClaudeMetrics(), null, "api");
      expect(errorFor("claude")).toBeNull();
      dispose();
    });
  });
});

describe("useMetrics - updateMetrics for codex", () => {
  test("sets codex metrics independently from claude", () => {
    createRoot((dispose) => {
      const { metricsFor, updateMetrics } = useMetrics();
      updateMetrics("codex", mockCodexMetrics(), null, "api");
      expect(metricsFor("codex")).not.toBeNull();
      expect(metricsFor("claude")).toBeNull(); // Claude unaffected
      dispose();
    });
  });

  test("codex error does not affect claude state", () => {
    createRoot((dispose) => {
      const { metricsFor, errorFor, updateMetrics } = useMetrics();
      updateMetrics("claude", mockClaudeMetrics(), null, "api");
      updateMetrics("codex", null, "codex error", "fallback");
      expect(errorFor("codex")).toBe("codex error");
      expect(metricsFor("claude")).not.toBeNull(); // Claude unaffected
      dispose();
    });
  });
});

describe("useMetrics - updateMetrics for grok", () => {
  test("tracks grok independently of the other services", () => {
    createRoot((dispose) => {
      const { metricsFor, errorFor, updateMetrics } = useMetrics();
      const grok = { subscription_type: "X Premium", weekly: { used_pct: 10, remaining_pct: 90, resets: "Oct 12" } };
      updateMetrics("grok", grok, null, "api");
      updateMetrics("codex", null, "codex error", "fallback");
      expect(metricsFor("grok")).toEqual(grok);
      expect(errorFor("grok")).toBeNull();
      expect(metricsFor("claude")).toBeNull();
      dispose();
    });
  });
});

describe("useMetrics - dataSources", () => {
  test("tracks source per service", () => {
    createRoot((dispose) => {
      const { dataSources, updateMetrics } = useMetrics();
      updateMetrics("claude", mockClaudeMetrics(), null, "api");
      updateMetrics("codex", mockCodexMetrics(), null, "pty");
      const sources = dataSources();
      expect(sources.claude).toBe("api");
      expect(sources.codex).toBe("pty");
      dispose();
    });
  });

  test("source updates on each call", () => {
    createRoot((dispose) => {
      const { dataSources, updateMetrics } = useMetrics();
      updateMetrics("claude", mockClaudeMetrics(), null, "api");
      expect(dataSources().claude).toBe("api");
      updateMetrics("claude", null, "err", "fallback");
      expect(dataSources().claude).toBe("fallback");
      dispose();
    });
  });
});

describe("useMetrics - checkWarning", () => {
  test("adds warning from degraded FetchResult", () => {
    createRoot((dispose) => {
      const { warnings, checkWarning } = useMetrics();
      expect(warnings()).toEqual([]);
      checkWarning("claude", {
        metrics: null,
        source: DataSource.FALLBACK,
        timestamp: Date.now() / 1000,
        error: "Unable to fetch usage data",
        stale: false,
      });
      expect(warnings().length).toBe(1);
      expect(warnings()[0].service).toBe("claude");
      dispose();
    });
  });

  test("clears warning when result is healthy", () => {
    createRoot((dispose) => {
      const { warnings, checkWarning } = useMetrics();
      // First add a warning
      checkWarning("claude", {
        metrics: null,
        source: DataSource.FALLBACK,
        timestamp: Date.now() / 1000,
        error: "Unable to fetch usage data",
        stale: false,
      });
      expect(warnings().length).toBe(1);
      // Then clear it
      checkWarning("claude", {
        metrics: { session: { used_pct: 10, remaining_pct: 90, resets: "2h" } },
        source: DataSource.API,
        timestamp: Date.now() / 1000,
        error: null,
        stale: false,
      });
      expect(warnings().length).toBe(0);
      dispose();
    });
  });

  test("warnings are per-service", () => {
    createRoot((dispose) => {
      const { warnings, checkWarning } = useMetrics();
      checkWarning("claude", {
        metrics: null,
        source: DataSource.FALLBACK,
        timestamp: Date.now() / 1000,
        error: "Unable to fetch usage data",
        stale: false,
      });
      checkWarning("codex", {
        metrics: null,
        source: DataSource.FALLBACK,
        timestamp: Date.now() / 1000,
        error: "Unable to fetch usage data",
        stale: false,
      });
      expect(warnings().length).toBe(2);
      dispose();
    });
  });
});
