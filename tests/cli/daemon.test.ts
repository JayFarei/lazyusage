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
