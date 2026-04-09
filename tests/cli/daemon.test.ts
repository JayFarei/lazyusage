import { describe, expect, test } from "bun:test";
import { createDaemonCommand } from "../../packages/cli/src/commands/daemon.js";

describe("createDaemonCommand", () => {
  test("registers a daemon start subcommand and parses start flags", async () => {
    const startCalls: Array<{
      interval?: number;
      services?: string[];
      foreground?: boolean;
      logLevel?: string;
    }> = [];

    const command = createDaemonCommand({
      onStart: async (options) => {
        startCalls.push(options);
      },
    }).exitOverride();

    await command.parseAsync([
      "node",
      "daemon",
      "start",
      "--interval",
      "120",
      "--services",
      "claude,codex",
      "--foreground",
      "--log-level",
      "debug",
    ]);

    expect(command.name()).toBe("daemon");
    expect(command.commands.map((subcommand) => subcommand.name())).toContain("start");
    expect(startCalls).toEqual([
      {
        interval: 120,
        services: ["claude", "codex"],
        foreground: true,
        logLevel: "debug",
      },
    ]);
  });

  test("loads daemon config and starts the daemon in background mode by default", async () => {
    const loadConfigCalls: Array<{
      interval?: number;
      services?: string[];
      logLevel?: string;
    }> = [];
    const startedConfigs: Array<{
      interval: number;
      services: string[];
      logLevel: string;
      ptyRecycleHours: number;
      configPath: string;
    }> = [];

    const command = createDaemonCommand({
      loadConfig: (overrides) => {
        loadConfigCalls.push(overrides);
        return {
          interval: 60,
          services: ["claude", "codex"],
          logLevel: "info",
          ptyRecycleHours: 4,
          configPath: "/tmp/daemon.toml",
        };
      },
      startBackground: async (config) => {
        startedConfigs.push(config);
        return 9876;
      },
    }).exitOverride();

    await command.parseAsync(["node", "daemon", "start"]);

    expect(loadConfigCalls).toEqual([{}]);
    expect(startedConfigs).toEqual([
      {
        interval: 60,
        services: ["claude", "codex"],
        logLevel: "info",
        ptyRecycleHours: 4,
        configPath: "/tmp/daemon.toml",
      },
    ]);
  });

  test("merges CLI start overrides into daemon config and routes foreground startup", async () => {
    const loadConfigCalls: Array<{
      interval?: number;
      services?: string[];
      logLevel?: string;
    }> = [];
    const foregroundConfigs: Array<{
      interval: number;
      services: string[];
      logLevel: string;
      ptyRecycleHours: number;
      configPath: string;
    }> = [];
    let backgroundCalls = 0;

    const command = createDaemonCommand({
      loadConfig: (overrides) => {
        loadConfigCalls.push(overrides);
        return {
          interval: 120,
          services: ["claude"],
          logLevel: "debug",
          ptyRecycleHours: 6,
          configPath: "/tmp/custom-daemon.toml",
        };
      },
      startForeground: async (config) => {
        foregroundConfigs.push(config);
      },
      startBackground: async () => {
        backgroundCalls += 1;
        return 9876;
      },
    }).exitOverride();

    await command.parseAsync([
      "node",
      "daemon",
      "start",
      "--interval",
      "120",
      "--services",
      "claude",
      "--foreground",
      "--log-level",
      "debug",
    ]);

    expect(loadConfigCalls).toEqual([
      {
        interval: 120,
        services: ["claude"],
        logLevel: "debug",
      },
    ]);
    expect(foregroundConfigs).toEqual([
      {
        interval: 120,
        services: ["claude"],
        logLevel: "debug",
        ptyRecycleHours: 6,
        configPath: "/tmp/custom-daemon.toml",
      },
    ]);
    expect(backgroundCalls).toBe(0);
  });
});

describe("CLI entrypoint daemon integration", () => {
  test("passes daemon help through to the daemon command group", async () => {
    const entrypointPath = new URL(
      "../../packages/cli/src/index.ts",
      import.meta.url,
    ).pathname;
    const subprocess = Bun.spawn({
      cmd: [Bun.argv[0], entrypointPath, "daemon", "--help"],
      cwd: new URL("../../", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
      env: globalThis.process.env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Manage the always-on collector daemon");
    expect(stdout).toContain("start");
  });
});
