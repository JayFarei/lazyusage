/**
 * Tests for resolveProjectName().
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

// Import after each test needs a fresh cache - we re-import lazily to work around module cache
// Since Bun caches module imports, the in-process Map cache persists across tests in the same file.
// Tests use unique paths so there are no cache collisions between tests.
import { resolveProjectName } from "../../packages/core/src/utils/project.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "proj-test-"));
}

describe("resolveProjectName - git root walk", () => {
  test("git root at same level as cwd (directory .git)", async () => {
    const tmpDir = await makeTempDir();
    try {
      await mkdir(join(tmpDir, ".git"), { recursive: true });
      const result = resolveProjectName(tmpDir);
      expect(result).toBe(basename(tmpDir));
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("git root at same level as cwd (file .git for worktrees)", async () => {
    const tmpDir = await makeTempDir();
    try {
      await writeFile(join(tmpDir, ".git"), "gitdir: /some/other/path/.git");
      const result = resolveProjectName(tmpDir);
      expect(result).toBe(basename(tmpDir));
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });

  test("git root 2 levels up returns git root leaf, not subdir", async () => {
    const tmpDir = await makeTempDir();
    try {
      await mkdir(join(tmpDir, ".git"), { recursive: true });
      const subDir = join(tmpDir, "packages", "cli");
      await mkdir(subDir, { recursive: true });
      const result = resolveProjectName(subDir);
      expect(result).toBe(basename(tmpDir));
    } finally {
      await rm(tmpDir, { recursive: true });
    }
  });
});

describe("resolveProjectName - collection dir heuristic", () => {
  test("src/tries/my-project returns my-project", () => {
    const result = resolveProjectName("/home/user/src/tries/my-project");
    expect(result).toBe("my-project");
  });

  test("projects/my-app returns my-app", () => {
    const result = resolveProjectName("/home/user/projects/my-app");
    expect(result).toBe("my-app");
  });

  test("repos/some-service returns some-service", () => {
    const result = resolveProjectName("/home/user/repos/some-service");
    expect(result).toBe("some-service");
  });

  test("nested collection dirs - takes component after the deepest match", () => {
    // src is a collection dir but next is tries (also collection dir), so skip
    // tries is a collection dir and next is the-project (not collection dir) -> "the-project"
    const result = resolveProjectName("/home/user/src/tries/the-project");
    expect(result).toBe("the-project");
  });
});

describe("resolveProjectName - leaf fallback", () => {
  test("no .git and no collection dir returns leaf name", () => {
    const result = resolveProjectName("/home/user/my-project");
    expect(result).toBe("my-project");
  });

  test("single component path returns it", () => {
    const result = resolveProjectName("/standalone");
    expect(result).toBe("standalone");
  });
});

describe("resolveProjectName - edge cases", () => {
  test("empty string returns unknown", () => {
    expect(resolveProjectName("")).toBe("unknown");
  });

  test("cache: repeated calls with same cwd return same value", () => {
    const cwd = "/tmp/unique-cache-test-path-12345";
    const first = resolveProjectName(cwd);
    const second = resolveProjectName(cwd);
    expect(first).toBe(second);
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
  });
});
