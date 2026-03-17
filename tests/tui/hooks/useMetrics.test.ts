/**
 * Tests for useMetrics hook.
 */
import { describe, test, expect } from "bun:test";
import { createRoot } from "solid-js";
import { useMetrics } from "../../../packages/cli/src/tui/hooks/useMetrics.js";
import { DataSource } from "@lazyusage/core";
import { mockClaudeMetrics, mockCodexMetrics } from "../helpers.js";

describe("useMetrics - updateMetrics for claude", () => {
  test("sets claudeMetrics signal on success", () => {
    createRoot((dispose) => {
      const { claudeMetrics, updateMetrics } = useMetrics();
      expect(claudeMetrics()).toBeNull();
      const metrics = mockClaudeMetrics();
      updateMetrics("claude", metrics, null, "api");
      expect(claudeMetrics()).toEqual(metrics);
      dispose();
    });
  });

  test("clears claudeMetrics and sets error on failure", () => {
    createRoot((dispose) => {
      const { claudeMetrics, claudeError, updateMetrics } = useMetrics();
      // Set metrics first
      updateMetrics("claude", mockClaudeMetrics(), null, "api");
      expect(claudeMetrics()).not.toBeNull();
      // Now fail
      updateMetrics("claude", null, "connection failed", "fallback");
      expect(claudeMetrics()).toBeNull();
      expect(claudeError()).toBe("connection failed");
      dispose();
    });
  });

  test("clears claudeError on subsequent success", () => {
    createRoot((dispose) => {
      const { claudeError, updateMetrics } = useMetrics();
      updateMetrics("claude", null, "error", "fallback");
      expect(claudeError()).toBe("error");
      updateMetrics("claude", mockClaudeMetrics(), null, "api");
      expect(claudeError()).toBeNull();
      dispose();
    });
  });
});

describe("useMetrics - updateMetrics for codex", () => {
  test("sets codexMetrics signal independently from claude", () => {
    createRoot((dispose) => {
      const { claudeMetrics, codexMetrics, updateMetrics } = useMetrics();
      updateMetrics("codex", mockCodexMetrics(), null, "api");
      expect(codexMetrics()).not.toBeNull();
      expect(claudeMetrics()).toBeNull(); // Claude unaffected
      dispose();
    });
  });

  test("codex error does not affect claude state", () => {
    createRoot((dispose) => {
      const { claudeMetrics, codexError, updateMetrics } = useMetrics();
      updateMetrics("claude", mockClaudeMetrics(), null, "api");
      updateMetrics("codex", null, "codex error", "fallback");
      expect(codexError()).toBe("codex error");
      expect(claudeMetrics()).not.toBeNull(); // Claude unaffected
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
        error: "All providers failed, using fallback zeros",
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
        error: "All providers failed, using fallback zeros",
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
        error: "All providers failed, using fallback zeros",
        stale: false,
      });
      checkWarning("codex", {
        metrics: null,
        source: DataSource.FALLBACK,
        timestamp: Date.now() / 1000,
        error: "All providers failed, using fallback zeros",
        stale: false,
      });
      expect(warnings().length).toBe(2);
      dispose();
    });
  });
});
