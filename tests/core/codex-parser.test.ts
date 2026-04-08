/**
 * Tests for parseCodexSessions().
 * Uses temp directories with synthetic JSONL files.
 */
import { describe, test, expect } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { parseCodexSessions } from "@lazyusage/core/parsers/codex-parser.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "codex-parser-test-"));
}

async function writeJsonl(dir: string, name: string, lines: unknown[]): Promise<void> {
  await Bun.write(join(dir, name), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

/** Build a session_meta first line */
function sessionMeta(opts: { cwd?: string; timestamp?: string; sessionId?: string } = {}): object {
  return {
    type: "session_meta",
    timestamp: opts.timestamp ?? "2026-02-17T10:00:00.000Z",
    payload: {
      cwd: opts.cwd ?? "/home/user/my-codex-project",
      timestamp: opts.timestamp ?? "2026-02-17T10:00:00.000Z",
      ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
    },
  };
}

/** Build a token_count event_msg */
function tokenCountEvent(opts: {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  infoNull?: boolean;
}): object {
  if (opts.infoNull) {
    return {
      type: "event_msg",
      payload: {
        type: "token_count",
        info: null,
      },
    };
  }
  return {
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: opts.inputTokens ?? 1000,
          cached_input_tokens: opts.cachedInputTokens ?? 0,
          output_tokens: opts.outputTokens ?? 500,
          reasoning_output_tokens: opts.reasoningTokens ?? 0,
          total_tokens: opts.totalTokens ?? 1500,
        },
      },
    },
  };
}

describe("parseCodexSessions - valid files", () => {
  test("parses file with session_meta and token_count", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        sessionMeta({ cwd: "/home/user/my-project" }),
        tokenCountEvent({ inputTokens: 1000, outputTokens: 500 }),
      ]);
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0].inputTokens).toBe(1000);
      expect(results[0].outputTokens).toBe(500);
      expect(results[0].totalTokens).toBe(1500);
      expect(results[0].service).toBe("codex");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("uses last token_count event (cumulative totals)", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        sessionMeta(),
        tokenCountEvent({ inputTokens: 500, outputTokens: 200 }), // early partial
        { type: "event_msg", payload: { type: "other" } },          // non-token event
        tokenCountEvent({ inputTokens: 2000, outputTokens: 800 }), // final cumulative
      ]);
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results).toHaveLength(1);
      // Uses last token_count: 2000 input, 800 output
      expect(results[0].inputTokens).toBe(2000);
      expect(results[0].outputTokens).toBe(800);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("includes cached and reasoning tokens", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        sessionMeta(),
        tokenCountEvent({
          inputTokens: 1000,
          cachedInputTokens: 200,
          outputTokens: 500,
          reasoningTokens: 100,
        }),
      ]);
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results[0].inputTokens).toBe(1200); // 1000 + 200
      expect(results[0].outputTokens).toBe(600);  // 500 + 100
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("extracts project name from cwd", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        sessionMeta({ cwd: "/home/user/projects/codex-app" }),
        tokenCountEvent({}),
      ]);
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results[0].project).toBe("codex-app");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

describe("parseCodexSessions - filtering", () => {
  test("sinceDate filter excludes older sessions", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "old.jsonl", [
        sessionMeta({ timestamp: "2026-01-01T10:00:00.000Z" }),
        tokenCountEvent({ inputTokens: 9999 }),
      ]);
      await writeJsonl(tmpDir, "recent.jsonl", [
        sessionMeta({ timestamp: "2026-02-17T10:00:00.000Z" }),
        tokenCountEvent({ inputTokens: 500 }),
      ]);
      const results = await parseCodexSessions("2026-02-01", tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0].inputTokens).toBe(500);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

describe("parseCodexSessions - error handling", () => {
  test("file missing session_meta as first line is skipped", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        tokenCountEvent({}), // no session_meta first
      ]);
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("file with session_meta but no token_count events is skipped", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        sessionMeta(),
        { type: "event_msg", payload: { type: "other_event" } },
      ]);
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("token_count events with null info are skipped", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        sessionMeta(),
        tokenCountEvent({ infoNull: true }),
        tokenCountEvent({ infoNull: true }),
        // No valid token_count
      ]);
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("empty file returns empty array", async () => {
    const tmpDir = await makeTempDir();
    try {
      await Bun.write(join(tmpDir, "empty.jsonl"), "");
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("malformed JSON lines are skipped gracefully", async () => {
    const tmpDir = await makeTempDir();
    try {
      const content =
        JSON.stringify(sessionMeta()) +
        "\n{ broken json\n" +
        JSON.stringify(tokenCountEvent({ inputTokens: 500 })) +
        "\n";
      await Bun.write(join(tmpDir, "session.jsonl"), content);
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results).toHaveLength(1);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("nonexistent directory returns empty array", async () => {
    const results = await parseCodexSessions(undefined, "/nonexistent/path");
    expect(results).toHaveLength(0);
  });

  test("multiple session files aggregated", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "s1.jsonl", [
        sessionMeta({ cwd: "/project-a" }),
        tokenCountEvent({ inputTokens: 1000 }),
      ]);
      await writeJsonl(tmpDir, "s2.jsonl", [
        sessionMeta({ cwd: "/project-b" }),
        tokenCountEvent({ inputTokens: 2000 }),
      ]);
      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results).toHaveLength(2);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

describe("parseCodexSessions - session deduplication", () => {
  test("duplicate session_id across files is deduplicated", async () => {
    const tmpDir = await makeTempDir();
    try {
      // Same session_id in two different files (e.g., sessions/ and archived_sessions/)
      await writeJsonl(tmpDir, "active.jsonl", [
        sessionMeta({ cwd: "/project-a", sessionId: "dup-session-1" }),
        tokenCountEvent({ inputTokens: 1000, outputTokens: 500 }),
      ]);
      await writeJsonl(tmpDir, "archived.jsonl", [
        sessionMeta({ cwd: "/project-a", sessionId: "dup-session-1" }),
        tokenCountEvent({ inputTokens: 1000, outputTokens: 500 }),
      ]);

      const results = await parseCodexSessions(undefined, tmpDir);
      // Should be 1, not 2
      expect(results).toHaveLength(1);
      expect(results[0].inputTokens).toBe(1000);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("different session_ids are all kept", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "s1.jsonl", [
        sessionMeta({ cwd: "/project-a", sessionId: "session-1" }),
        tokenCountEvent({ inputTokens: 1000 }),
      ]);
      await writeJsonl(tmpDir, "s2.jsonl", [
        sessionMeta({ cwd: "/project-b", sessionId: "session-2" }),
        tokenCountEvent({ inputTokens: 2000 }),
      ]);

      const results = await parseCodexSessions(undefined, tmpDir);
      expect(results).toHaveLength(2);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("sessions without session_id are always kept", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "s1.jsonl", [
        sessionMeta({ cwd: "/project-a" }),
        tokenCountEvent({ inputTokens: 1000 }),
      ]);
      await writeJsonl(tmpDir, "s2.jsonl", [
        sessionMeta({ cwd: "/project-b" }),
        tokenCountEvent({ inputTokens: 2000 }),
      ]);

      const results = await parseCodexSessions(undefined, tmpDir);
      // No session_id, so no dedup possible
      expect(results).toHaveLength(2);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});
