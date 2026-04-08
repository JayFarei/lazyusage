/**
 * Tests for parseClaudeSessions().
 * Uses temp directories with synthetic JSONL files.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { parseClaudeSessions } from "@lazyusage/core/parsers/claude-parser.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "claude-parser-test-"));
}

async function writeJsonl(dir: string, name: string, lines: unknown[]): Promise<void> {
  await Bun.write(join(dir, name), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

/** Build a synthetic assistant event line */
function assistantEvent(opts: {
  cwd?: string;
  timestamp?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  isSidechain?: boolean;
}): object {
  return {
    type: "assistant",
    isSidechain: opts.isSidechain ?? false,
    cwd: opts.cwd ?? "/home/user/my-project",
    timestamp: opts.timestamp ?? "2026-02-17T10:00:00.000Z",
    message: {
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: opts.inputTokens ?? 1000,
        output_tokens: opts.outputTokens ?? 500,
        cache_read_input_tokens: opts.cacheReadTokens ?? 0,
        cache_creation_input_tokens: opts.cacheCreationTokens ?? 0,
      },
    },
  };
}

describe("parseClaudeSessions - valid files", () => {
  test("parses valid multi-event file and sums tokens correctly", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        assistantEvent({ inputTokens: 1000, outputTokens: 500 }),
        assistantEvent({ inputTokens: 2000, outputTokens: 800 }),
      ]);
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results).toHaveLength(2);
      expect(results[0].inputTokens).toBe(1000);
      expect(results[0].outputTokens).toBe(500);
      expect(results[0].totalTokens).toBe(1500);
      expect(results[1].totalTokens).toBe(2800);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("separates fresh input, cache read, and cache creation tokens", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        assistantEvent({
          inputTokens: 1000,
          cacheReadTokens: 200,
          cacheCreationTokens: 300,
          outputTokens: 500,
        }),
      ]);
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0].inputTokens).toBe(1000);        // fresh input only
      expect(results[0].cacheReadTokens).toBe(200);
      expect(results[0].cacheCreationTokens).toBe(300);
      expect(results[0].totalTokens).toBe(2000);        // 1000 + 200 + 300 + 500
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("extracts project name from cwd", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        assistantEvent({ cwd: "/home/user/projects/my-app" }),
      ]);
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results[0].project).toBe("my-app");
      expect(results[0].cwd).toBe("/home/user/projects/my-app");
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("extracts date from timestamp as YYYY-MM-DD", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        assistantEvent({ timestamp: "2026-02-17T10:00:00.000Z" }),
      ]);
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results[0].service).toBe("claude");
      // Date is in local time, so we just verify it's a valid date string
      expect(results[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

describe("parseClaudeSessions - filtering", () => {
  test("isSidechain=true events are skipped", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        assistantEvent({ isSidechain: true, inputTokens: 9999 }),
        assistantEvent({ isSidechain: false, inputTokens: 1000 }),
      ]);
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0].inputTokens).toBe(1000);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("sinceDate filter excludes older sessions", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        assistantEvent({ timestamp: "2026-01-01T10:00:00.000Z" }), // old
        assistantEvent({ timestamp: "2026-02-17T10:00:00.000Z" }), // recent
      ]);
      const results = await parseClaudeSessions("2026-02-01", tmpDir);
      // Only the Feb 17 event should be included
      expect(results).toHaveLength(1);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("non-assistant events are skipped", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        { type: "user", cwd: "/project", message: "hello" },
        { type: "tool_result", cwd: "/project" },
        assistantEvent({ inputTokens: 500 }),
      ]);
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results).toHaveLength(1);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

describe("parseClaudeSessions - error handling", () => {
  test("empty file returns empty array", async () => {
    const tmpDir = await makeTempDir();
    try {
      await Bun.write(join(tmpDir, "empty.jsonl"), "");
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("malformed JSON line is skipped, valid lines are parsed", async () => {
    const tmpDir = await makeTempDir();
    try {
      const content =
        JSON.stringify(assistantEvent({ inputTokens: 1000 })) +
        "\n" +
        "{ invalid json\n" +
        JSON.stringify(assistantEvent({ inputTokens: 2000 })) +
        "\n";
      await Bun.write(join(tmpDir, "session.jsonl"), content);
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results).toHaveLength(2);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("file with no assistant events returns empty array", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session.jsonl", [
        { type: "user", message: "hello" },
        { type: "system", data: "init" },
      ]);
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results).toHaveLength(0);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("nonexistent directory returns empty array", async () => {
    const results = await parseClaudeSessions(undefined, "/nonexistent/path/that/does/not/exist");
    expect(results).toHaveLength(0);
  });

  test("multiple files are all parsed", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeJsonl(tmpDir, "session1.jsonl", [assistantEvent({ inputTokens: 1000 })]);
      await writeJsonl(tmpDir, "session2.jsonl", [assistantEvent({ inputTokens: 2000 })]);
      const results = await parseClaudeSessions(undefined, tmpDir);
      expect(results).toHaveLength(2);
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});
