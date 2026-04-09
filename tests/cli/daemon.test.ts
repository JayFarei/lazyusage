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

  test("registers a daemon stop subcommand and stops the daemon via its pid file", async () => {
    const signalCalls: Array<{ pid: number; signal: "SIGTERM" }> = [];
    const waitCalls: number[] = [];
    const output: string[] = [];

    const command = createDaemonCommand({
      readPidFile: (path) => {
        expect(path).toContain("daemon.pid");
        return "4321\n";
      },
      signalProcess: (pid, signal) => {
        signalCalls.push({ pid, signal });
      },
      waitForProcessExit: async (pid) => {
        waitCalls.push(pid);
      },
      writeStdout: (message) => {
        output.push(message);
      },
    }).exitOverride();

    await command.parseAsync(["node", "daemon", "stop"]);

    expect(command.commands.map((subcommand) => subcommand.name())).toContain("stop");
    expect(signalCalls).toEqual([{ pid: 4321, signal: "SIGTERM" }]);
    expect(waitCalls).toEqual([4321]);
    expect(output).toEqual(["Stopped daemon 4321."]);
  });

  test("registers a daemon status subcommand and prints a heartbeat summary", async () => {
    const output: string[] = [];

    const command = createDaemonCommand({
      readPidFile: () => "4321\n",
      isProcessRunning: (pid) => pid === 4321,
      createStore: () => ({
        getDaemonStatus: (service: string) => {
          if (service === "_daemon") {
            return {
              service: "_daemon",
              lastCollectedAt: null,
              lastSource: null,
              lastError: null,
              consecutiveFailures: 0,
              pid: 4321,
              startedAt: "2026-04-09T11:58:00.000Z",
              updatedAt: "2026-04-09T12:00:00.000Z",
            };
          }

          if (service === "claude") {
            return {
              service: "claude",
              lastCollectedAt: "2026-04-09T11:59:30.000Z",
              lastSource: "api",
              lastError: null,
              consecutiveFailures: 0,
              pid: null,
              startedAt: null,
              updatedAt: "2026-04-09T12:00:00.000Z",
            };
          }

          return {
            service: "codex",
            lastCollectedAt: "2026-04-09T11:55:00.000Z",
            lastSource: "pty",
            lastError: "rate limited",
            consecutiveFailures: 2,
            pid: null,
            startedAt: null,
            updatedAt: "2026-04-09T12:00:00.000Z",
          };
        },
        isDaemonHeartbeatFresh: (service: string) => service === "claude",
        close: () => {},
      }),
      now: () => new Date("2026-04-09T12:00:00.000Z").getTime(),
      writeStdout: (message) => {
        output.push(message);
      },
    }).exitOverride();

    await command.parseAsync(["node", "daemon", "status"]);

    expect(command.commands.map((subcommand) => subcommand.name())).toContain("status");
    expect(output).toEqual([
      "Daemon: running (pid 4321, uptime 2m) | Claude: healthy 30s ago via API | Codex: stale 5m ago via Terminal (2 failures, last error: rate limited)",
    ]);
  });

  test("registers a daemon logs subcommand and tails the requested number of log lines", async () => {
    const output: string[] = [];

    const command = createDaemonCommand({
      readLogFile: (path) => {
        expect(path).toContain("daemon.log");
        return [
          "2026-04-09T11:58:00.000Z [INFO] boot",
          "2026-04-09T11:59:00.000Z [WARN] slow refresh",
          "2026-04-09T12:00:00.000Z [ERROR] collector failed",
        ].join("\n");
      },
      writeStdout: (message) => {
        output.push(message);
      },
    }).exitOverride();

    await command.parseAsync([
      "node",
      "daemon",
      "logs",
      "--lines",
      "2",
    ]);

    expect(command.commands.map((subcommand) => subcommand.name())).toContain("logs");
    expect(output).toEqual([
      "2026-04-09T11:59:00.000Z [WARN] slow refresh\n2026-04-09T12:00:00.000Z [ERROR] collector failed",
    ]);
  });

  test("registers a daemon logs subcommand and follows appended log output", async () => {
    const output: string[] = [];
    const followCalls: string[] = [];

    const command = createDaemonCommand({
      readLogFile: () =>
        [
          "2026-04-09T11:59:00.000Z [WARN] slow refresh",
          "2026-04-09T12:00:00.000Z [INFO] collector recovered",
        ].join("\n"),
      followLogFile: async (path, onChunk) => {
        followCalls.push(path);
        onChunk("2026-04-09T12:01:00.000Z [ERROR] collector failed\n");
      },
      writeStdout: (message) => {
        output.push(message);
      },
    }).exitOverride();

    await command.parseAsync([
      "node",
      "daemon",
      "logs",
      "--lines",
      "1",
      "--follow",
    ]);

    expect(command.commands.map((subcommand) => subcommand.name())).toContain("logs");
    expect(followCalls).toHaveLength(1);
    expect(followCalls[0]).toContain("daemon.log");
    expect(output).toEqual([
      "2026-04-09T12:00:00.000Z [INFO] collector recovered",
      "2026-04-09T12:01:00.000Z [ERROR] collector failed",
    ]);
  });

  test("registers a daemon install subcommand and writes a launchd plist on macOS", async () => {
    const writes: Array<{ path: string; contents: string }> = [];
    const serviceManagerCommands: string[][] = [];
    const output: string[] = [];

    const command = createDaemonCommand({
      platform: "darwin",
      homeDir: "/Users/tester",
      runtimeExecutablePath: "/opt/homebrew/bin/bun",
      cliEntrypointPath: "/tmp/lazyusage-cli.js",
      loadConfig: () => ({
        interval: 120,
        services: ["claude"],
        logLevel: "debug",
        ptyRecycleHours: 4,
        configPath: "/Users/tester/.config/lazyusage/daemon.toml",
      }),
      writeServiceFile: (path, contents) => {
        writes.push({ path, contents });
      },
      runServiceManagerCommand: (command) => {
        serviceManagerCommands.push(command);
      },
      writeStdout: (message) => {
        output.push(message);
      },
    }).exitOverride();

    await command.parseAsync(["node", "daemon", "install"]);

    expect(command.commands.map((subcommand) => subcommand.name())).toContain("install");
    expect(writes).toEqual([
      {
        path: "/Users/tester/Library/LaunchAgents/com.lazyusage.daemon.plist",
        contents: expect.stringContaining("<string>/opt/homebrew/bin/bun</string>"),
      },
    ]);
    expect(writes[0]?.contents).toContain("<string>/tmp/lazyusage-cli.js</string>");
    expect(writes[0]?.contents).toContain("<string>daemon</string>");
    expect(writes[0]?.contents).toContain("<string>start</string>");
    expect(writes[0]?.contents).toContain("<string>--foreground</string>");
    expect(writes[0]?.contents).toContain("<string>--interval</string>");
    expect(writes[0]?.contents).toContain("<string>120</string>");
    expect(writes[0]?.contents).toContain("<string>--services</string>");
    expect(writes[0]?.contents).toContain("<string>claude</string>");
    expect(writes[0]?.contents).toContain("<string>--log-level</string>");
    expect(writes[0]?.contents).toContain("<string>debug</string>");
    expect(writes[0]?.contents).toContain("<key>RunAtLoad</key>");
    expect(writes[0]?.contents).toContain("<key>KeepAlive</key>");
    expect(serviceManagerCommands).toEqual([
      [
        "launchctl",
        "load",
        "/Users/tester/Library/LaunchAgents/com.lazyusage.daemon.plist",
      ],
    ]);
    expect(output).toEqual([
      "Installed daemon service at /Users/tester/Library/LaunchAgents/com.lazyusage.daemon.plist.",
    ]);
  });

  test("registers a daemon uninstall subcommand and unloads the launchd service on macOS", async () => {
    const serviceManagerCommands: string[][] = [];
    const removedPaths: string[] = [];
    const output: string[] = [];

    const command = createDaemonCommand({
      platform: "darwin",
      homeDir: "/Users/tester",
      runServiceManagerCommand: (command) => {
        serviceManagerCommands.push(command);
      },
      removeServiceFile: (path) => {
        removedPaths.push(path);
      },
      writeStdout: (message) => {
        output.push(message);
      },
    }).exitOverride();

    await command.parseAsync(["node", "daemon", "uninstall"]);

    expect(command.commands.map((subcommand) => subcommand.name())).toContain("uninstall");
    expect(serviceManagerCommands).toEqual([
      [
        "launchctl",
        "unload",
        "/Users/tester/Library/LaunchAgents/com.lazyusage.daemon.plist",
      ],
    ]);
    expect(removedPaths).toEqual([
      "/Users/tester/Library/LaunchAgents/com.lazyusage.daemon.plist",
    ]);
    expect(output).toEqual([
      "Uninstalled daemon service from /Users/tester/Library/LaunchAgents/com.lazyusage.daemon.plist.",
    ]);
  });

  test("registers a daemon uninstall subcommand and disables the systemd user service on Linux", async () => {
    const serviceManagerCommands: string[][] = [];
    const removedPaths: string[] = [];
    const output: string[] = [];

    const command = createDaemonCommand({
      platform: "linux",
      homeDir: "/home/tester",
      runServiceManagerCommand: (command) => {
        serviceManagerCommands.push(command);
      },
      removeServiceFile: (path) => {
        removedPaths.push(path);
      },
      writeStdout: (message) => {
        output.push(message);
      },
    }).exitOverride();

    await command.parseAsync(["node", "daemon", "uninstall"]);

    expect(command.commands.map((subcommand) => subcommand.name())).toContain("uninstall");
    expect(serviceManagerCommands).toEqual([
      ["systemctl", "--user", "disable", "--now", "lazyusage-daemon.service"],
      ["systemctl", "--user", "daemon-reload"],
    ]);
    expect(removedPaths).toEqual([
      "/home/tester/.config/systemd/user/lazyusage-daemon.service",
    ]);
    expect(output).toEqual([
      "Uninstalled daemon service from /home/tester/.config/systemd/user/lazyusage-daemon.service.",
    ]);
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
