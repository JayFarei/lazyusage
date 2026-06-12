import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDaemonConfig } from "../../../packages/core/src/daemon/config.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "lazyusage-daemon-config-"));
}

describe("loadDaemonConfig", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    configPath = join(tempDir, "daemon.toml");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns zero-config defaults when no config file exists", () => {
    const config = loadDaemonConfig({ configPath });

    expect(config).toEqual({
      interval: 60,
      services: ["claude", "codex"],
      logLevel: "info",
      ptyRecycleHours: 4,
      configPath,
    });
  });

  test("loads daemon settings from an optional TOML config file", () => {
    writeFileSync(
      configPath,
      ["interval = 120", 'services = ["codex"]', 'log_level = "debug"', "", "[pty]", "recycle_hours = 6"].join("\n"),
    );

    const config = loadDaemonConfig({ configPath });

    expect(config).toEqual({
      interval: 120,
      services: ["codex"],
      logLevel: "debug",
      ptyRecycleHours: 6,
      configPath,
    });
  });

  test("prefers CLI overrides over values from the config file", () => {
    writeFileSync(
      configPath,
      ["interval = 120", 'services = ["claude"]', 'log_level = "error"', "", "[pty]", "recycle_hours = 8"].join("\n"),
    );

    const config = loadDaemonConfig({
      configPath,
      interval: 30,
      services: ["codex", "claude"],
      logLevel: "warn",
      ptyRecycleHours: 2,
    });

    expect(config).toEqual({
      interval: 30,
      services: ["codex", "claude"],
      logLevel: "warn",
      ptyRecycleHours: 2,
      configPath,
    });
  });
});
