import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonLogger } from "../../../packages/core/src/daemon/logger.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "lazyusage-daemon-logger-"));
}

describe("createDaemonLogger", () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    logPath = join(tempDir, "logs", "daemon.log");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates the log file on demand and appends formatted entries", () => {
    const logger = createDaemonLogger({
      logPath,
      now: () => new Date("2026-04-09T12:00:00.000Z"),
    });

    logger.info("collector started");

    expect(existsSync(logPath)).toBe(true);
    expect(readFileSync(logPath, "utf-8")).toBe("2026-04-09T12:00:00.000Z [INFO] collector started\n");
  });

  test("rotates the active log file when the next entry would exceed the max size", () => {
    const timestamp = "2026-04-09T12:00:00.000Z";
    const firstEntry = `${timestamp} [INFO] first cycle\n`;
    const secondEntry = `${timestamp} [ERROR] second cycle\n`;
    const logger = createDaemonLogger({
      logPath,
      now: () => new Date(timestamp),
      maxSizeBytes: firstEntry.length + 1,
      keepFiles: 2,
    });

    logger.info("first cycle");
    logger.error("second cycle");

    expect(readFileSync(`${logPath}.1`, "utf-8")).toBe(firstEntry);
    expect(readFileSync(logPath, "utf-8")).toBe(secondEntry);
  });
});
