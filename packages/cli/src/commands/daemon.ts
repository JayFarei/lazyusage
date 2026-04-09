import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import {
  DATA_SOURCE_LABELS,
  DEFAULT_DAEMON_PID_PATH,
  DEFAULT_DAEMON_LOG_PATH,
  UsageStore,
  loadDaemonConfig,
  type DaemonConfig,
  type DaemonConfigOverrides,
  type DaemonLogLevel,
  type ServiceName,
} from "@lazyusage/core";

export interface DaemonStartOptions {
  interval?: number;
  services?: string[];
  foreground?: boolean;
  logLevel?: string;
}

type DaemonStatusStore = Pick<
  UsageStore,
  "getDaemonStatus" | "isDaemonHeartbeatFresh" | "close"
>;

type DaemonStatusRow = NonNullable<ReturnType<UsageStore["getDaemonStatus"]>>;
type DaemonInstallPlatform = "darwin" | "linux";

const DAEMON_LAUNCHD_LABEL = "com.lazyusage.daemon";
const DAEMON_SYSTEMD_UNIT_NAME = "lazyusage-daemon.service";

export interface DaemonCommandOptions {
  onStart?: (options: DaemonStartOptions) => Promise<void> | void;
  loadConfig?: (overrides: DaemonConfigOverrides) => DaemonConfig;
  startForeground?: (config: DaemonConfig) => Promise<void> | void;
  startBackground?: (config: DaemonConfig) => Promise<number> | number;
  pidFilePath?: string;
  logFilePath?: string;
  readPidFile?: (path: string) => string;
  readLogFile?: (path: string) => string;
  followLogFile?: (
    path: string,
    onChunk: (chunk: string) => void,
  ) => Promise<void> | void;
  signalProcess?: (pid: number, signal: "SIGTERM") => void;
  isProcessRunning?: (pid: number) => boolean;
  waitForProcessExit?: (pid: number) => Promise<void>;
  writeStdout?: (message: string) => void;
  stopTimeoutMs?: number;
  stopPollIntervalMs?: number;
  createStore?: () => DaemonStatusStore;
  now?: () => number;
  platform?: NodeJS.Platform;
  homeDir?: string;
  runtimeExecutablePath?: string;
  cliEntrypointPath?: string;
  writeServiceFile?: (path: string, contents: string) => void;
  runServiceManagerCommand?: (command: string[]) => Promise<void> | void;
}

function isServiceName(value: string): value is ServiceName {
  return value === "claude" || value === "codex";
}

function parseServices(input?: string): string[] | undefined {
  if (!input) {
    return undefined;
  }

  const services = input
    .split(",")
    .map((service) => service.trim())
    .filter(Boolean);

  return services.length > 0 ? services : undefined;
}

function parseInterval(input?: string): number | undefined {
  if (!input) {
    return undefined;
  }

  const interval = Number.parseInt(input, 10);
  return Number.isFinite(interval) ? interval : undefined;
}

function parseLineCount(input?: string): number | undefined {
  if (!input) {
    return undefined;
  }

  const count = Number.parseInt(input, 10);
  return Number.isInteger(count) && count > 0 ? count : undefined;
}

function parseLogLevelOverride(input?: string): DaemonLogLevel | undefined {
  if (
    input === "error"
    || input === "warn"
    || input === "info"
    || input === "debug"
  ) {
    return input;
  }

  return undefined;
}

function parseServiceOverrides(input?: string[]): ServiceName[] | undefined {
  if (!input || !input.every(isServiceName)) {
    return undefined;
  }

  return input;
}

function parsePid(pidContents: string): number {
  const pid = Number.parseInt(pidContents.trim(), 10);

  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Daemon PID file is invalid.");
  }

  return pid;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${totalHours}h` : `${totalHours}h ${minutes}m`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

function formatAge(timestamp: string | null, nowMs: number): string | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return formatDuration(nowMs - parsed);
}

function formatServiceSummary(
  service: ServiceName,
  status: DaemonStatusRow | null,
  fresh: boolean,
  nowMs: number,
): string {
  const label = service[0].toUpperCase() + service.slice(1);

  if (!status?.lastCollectedAt) {
    return `${label}: no heartbeat`;
  }

  const age = formatAge(status.lastCollectedAt, nowMs);
  const source = status.lastSource
    ? (DATA_SOURCE_LABELS[status.lastSource] ?? status.lastSource)
    : null;
  const summary = `${fresh ? "healthy" : "stale"}${age ? ` ${age} ago` : ""}${source ? ` via ${source}` : ""}`;
  const details: string[] = [];

  if (status.consecutiveFailures > 0) {
    details.push(
      `${status.consecutiveFailures} failure${status.consecutiveFailures === 1 ? "" : "s"}`,
    );
  }

  if (status.lastError) {
    details.push(`last error: ${status.lastError}`);
  }

  return `${label}: ${summary}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

function tailLogContent(contents: string, lineCount: number): string {
  const lines = contents.split(/\r?\n/);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.slice(-lineCount).join("\n");
}

function trimTrailingLineBreaks(contents: string): string {
  return contents.replace(/(?:\r?\n)+$/u, "");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function quoteSystemdArg(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")}"`;
}

function createDaemonStartArgs(config: DaemonConfig): string[] {
  return [
    "daemon",
    "start",
    "--foreground",
    "--interval",
    String(config.interval),
    "--services",
    config.services.join(","),
    "--log-level",
    config.logLevel,
  ];
}

function getServiceDefinitionPath(
  platform: DaemonInstallPlatform,
  homeDirPath: string,
): string {
  if (platform === "darwin") {
    return join(
      homeDirPath,
      "Library",
      "LaunchAgents",
      `${DAEMON_LAUNCHD_LABEL}.plist`,
    );
  }

  return join(
    homeDirPath,
    ".config",
    "systemd",
    "user",
    DAEMON_SYSTEMD_UNIT_NAME,
  );
}

function renderLaunchdPlist(
  command: string[],
  workingDirectory: string,
): string {
  const programArguments = command
    .map((argument) => `      <string>${escapeXml(argument)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${DAEMON_LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${programArguments}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${escapeXml(workingDirectory)}</string>
  </dict>
</plist>
`;
}

function renderSystemdUnit(
  command: string[],
  workingDirectory: string,
): string {
  const execStart = command.map(quoteSystemdArg).join(" ");

  return `[Unit]
Description=lazyusage collector daemon

[Service]
Type=simple
WorkingDirectory=${workingDirectory}
ExecStart=${execStart}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}

function getInstallServiceManagerCommands(
  platform: DaemonInstallPlatform,
  serviceFilePath: string,
): string[][] {
  if (platform === "darwin") {
    return [["launchctl", "load", serviceFilePath]];
  }

  return [
    ["systemctl", "--user", "daemon-reload"],
    ["systemctl", "--user", "enable", "--now", DAEMON_SYSTEMD_UNIT_NAME],
  ];
}

export function createDaemonCommand(
  options: DaemonCommandOptions = {},
): Command {
  const pidFilePath = options.pidFilePath ?? DEFAULT_DAEMON_PID_PATH;
  const logFilePath = options.logFilePath ?? DEFAULT_DAEMON_LOG_PATH;
  const platform = options.platform ?? process.platform;
  const homeDirPath = options.homeDir ?? homedir();
  const runtimeExecutablePath =
    options.runtimeExecutablePath ?? process.execPath;
  const cliEntrypointPath = options.cliEntrypointPath ?? process.argv[1];
  const readPidFile =
    options.readPidFile ??
    ((path: string): string => {
      if (!existsSync(path)) {
        throw new Error("Daemon is not running.");
      }

      return readFileSync(path, "utf-8");
    });
  const readLogFile =
    options.readLogFile ??
    ((path: string): string => readFileSync(path, "utf-8"));
  const followLogFile =
    options.followLogFile ??
    ((path: string, onChunk: (chunk: string) => void): Promise<void> =>
      new Promise((resolve, reject) => {
        let previousContents = readLogFile(path);
        const watcher = watch(path, () => {
          try {
            const nextContents = readLogFile(path);
            const chunk = nextContents.startsWith(previousContents)
              ? nextContents.slice(previousContents.length)
              : nextContents;
            previousContents = nextContents;

            if (chunk.length > 0) {
              onChunk(chunk);
            }
          } catch (error) {
            watcher.close();
            reject(error);
          }
        });

        watcher.on("error", (error) => {
          watcher.close();
          reject(error);
        });
      }));
  const signalProcess =
    options.signalProcess ??
    ((pid: number, signal: "SIGTERM"): void => {
      process.kill(pid, signal);
    });
  const isProcessRunning =
    options.isProcessRunning ??
    ((pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  const writeStdout = options.writeStdout ?? ((message: string) => console.log(message));
  const createStore = options.createStore ?? (() => new UsageStore());
  const now = options.now ?? (() => Date.now());
  const writeServiceFile =
    options.writeServiceFile ??
    ((path: string, contents: string): void => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents, "utf-8");
    });
  const runServiceManagerCommand =
    options.runServiceManagerCommand ??
    ((command: string[]): void => {
      const result = Bun.spawnSync(command, {
        stdout: "ignore",
        stderr: "pipe",
      });

      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString().trim();
        throw new Error(
          stderr.length > 0
            ? stderr
            : `Service manager command failed: ${command.join(" ")}`,
        );
      }
    });
  const waitForProcessExit =
    options.waitForProcessExit ??
    (async (pid: number): Promise<void> => {
      const timeoutMs = options.stopTimeoutMs ?? 5000;
      const pollIntervalMs = options.stopPollIntervalMs ?? 100;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() < deadline) {
        if (!isProcessRunning(pid)) {
          return;
        }

        await Bun.sleep(pollIntervalMs);
      }

      if (isProcessRunning(pid)) {
        throw new Error(`Timed out waiting for daemon ${pid} to exit.`);
      }
    });

  const command = new Command("daemon")
    .description("Manage the always-on collector daemon");

  command
    .command("start")
    .description("Start the collector daemon")
    .option("--interval <seconds>", "Collection interval in seconds")
    .option("--services <services>", "Comma-separated services to collect")
    .option("--foreground", "Run in the foreground instead of forking")
    .option("--log-level <level>", "Daemon log level")
    .action(async (input: {
      interval?: string;
      services?: string;
      foreground?: boolean;
      logLevel?: string;
    }) => {
      const startOptions: DaemonStartOptions = {
        interval: parseInterval(input.interval),
        services: parseServices(input.services),
        foreground: input.foreground,
        logLevel: input.logLevel,
      };

      if (options.onStart) {
        await options.onStart(startOptions);
        return;
      }

      const config = (options.loadConfig ?? loadDaemonConfig)({
        interval: startOptions.interval,
        services: parseServiceOverrides(startOptions.services),
        logLevel: parseLogLevelOverride(startOptions.logLevel),
      });

      if (startOptions.foreground) {
        await options.startForeground?.(config);
        return;
      }

      await options.startBackground?.(config);
    });

  command
    .command("stop")
    .description("Stop the collector daemon")
    .action(async () => {
      const pid = parsePid(readPidFile(pidFilePath));
      signalProcess(pid, "SIGTERM");
      await waitForProcessExit(pid);
      writeStdout(`Stopped daemon ${pid}.`);
    });

  command
    .command("status")
    .description("Show collector daemon status")
    .action(() => {
      let pid: number | null = null;

      try {
        pid = parsePid(readPidFile(pidFilePath));
      } catch {
        writeStdout("Daemon: stopped");
        return;
      }

      if (!isProcessRunning(pid)) {
        writeStdout(`Daemon: stopped (stale pid ${pid})`);
        return;
      }

      const store = createStore();

      try {
        const daemonStatus = store.getDaemonStatus("_daemon");
        const nowMs = now();
        const uptime = formatAge(daemonStatus?.startedAt ?? null, nowMs);
        const daemonSummary = uptime
          ? `Daemon: running (pid ${pid}, uptime ${uptime})`
          : `Daemon: running (pid ${pid})`;

        const services: ServiceName[] = ["claude", "codex"];
        const serviceSummaries = services.map((service) =>
          formatServiceSummary(
            service,
            store.getDaemonStatus(service),
            store.isDaemonHeartbeatFresh(service),
            nowMs,
          ));

        writeStdout([daemonSummary, ...serviceSummaries].join(" | "));
      } finally {
        store.close();
      }
    });

  command
    .command("logs")
    .description("Show recent daemon log output")
    .option("--lines <count>", "Number of log lines to show")
    .option("--follow", "Follow appended log output")
    .action(async (input: { lines?: string; follow?: boolean }) => {
      const lineCount = parseLineCount(input.lines) ?? 10;
      const contents = readLogFile(logFilePath);
      const output = tailLogContent(contents, lineCount);

      if (!input.follow) {
        writeStdout(output);
        return;
      }

      if (output.length > 0) {
        writeStdout(output);
      }

      await followLogFile(logFilePath, (chunk) => {
        const trimmed = trimTrailingLineBreaks(chunk);
        if (trimmed.length > 0) {
          writeStdout(trimmed);
        }
      });
    });

  command
    .command("install")
    .description("Install the collector daemon as a background service")
    .action(async () => {
      if (platform !== "darwin" && platform !== "linux") {
        throw new Error(`Daemon install is not supported on ${platform}.`);
      }

      const config = (options.loadConfig ?? loadDaemonConfig)({});
      const commandArgs = [
        runtimeExecutablePath,
        cliEntrypointPath,
        ...createDaemonStartArgs(config),
      ];
      const serviceFilePath = getServiceDefinitionPath(platform, homeDirPath);
      const serviceContents = platform === "darwin"
        ? renderLaunchdPlist(commandArgs, process.cwd())
        : renderSystemdUnit(commandArgs, process.cwd());

      writeServiceFile(serviceFilePath, serviceContents);
      for (const serviceManagerCommand of getInstallServiceManagerCommands(
        platform,
        serviceFilePath,
      )) {
        await runServiceManagerCommand(serviceManagerCommand);
      }
      writeStdout(`Installed daemon service at ${serviceFilePath}.`);
    });

  return command;
}
