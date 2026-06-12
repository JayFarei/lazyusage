/**
 * Tmux session management for E2E TUI tests.
 */
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../../..");
const PRELOAD = join(ROOT, "packages/cli/node_modules/@opentui/solid/scripts/preload.ts");
const TUI_SCRIPT = join(ROOT, "packages/cli/src/index.ts");

/** Check if tmux is available on this system. */
export async function isTmuxAvailable(): Promise<boolean> {
  const proc = Bun.spawnSync(["which", "tmux"]);
  return proc.exitCode === 0;
}

/** Run a tmux command and return exit code + stdout. */
async function runTmux(
  args: string[],
  opts: { capture?: boolean; suppressErrors?: boolean } = {},
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["tmux", ...args], {
    stdout: opts.capture ? "pipe" : "ignore",
    stderr: opts.suppressErrors ? "ignore" : "pipe",
  });
  const stdout = opts.capture && proc.stdout ? await new Response(proc.stdout).text() : "";
  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

/** Create a new detached tmux session at the specified dimensions. */
export async function createTestSession(name: string, width: number, height: number): Promise<void> {
  // Kill any existing session with this name
  await runTmux(["kill-session", "-t", name], { suppressErrors: true });
  await runTmux(["new-session", "-d", "-s", name, "-x", String(width), "-y", String(height)]);
}

/**
 * Create a tmux session that runs the TUI command directly (no shell wrapper).
 * When the TUI process exits, the session is automatically destroyed.
 * Use this for tests that need to verify clean process exit (e.g. quit key).
 */
export async function createDirectTUISession(
  name: string,
  width: number,
  height: number,
  args: string[] = [],
): Promise<void> {
  await runTmux(["kill-session", "-t", name], { suppressErrors: true });
  const argStr = args.length > 0 ? ` ${args.join(" ")}` : "";
  const cmd = `bun --preload=${PRELOAD} ${TUI_SCRIPT} usage${argStr}`;
  await runTmux(["new-session", "-d", "-s", name, "-x", String(width), "-y", String(height), cmd]);
}

/** Launch the TUI in a tmux session. */
export async function launchTUI(sessionName: string, args: string[] = [], env?: Record<string, string>): Promise<void> {
  const argStr = args.length > 0 ? ` ${args.join(" ")}` : "";
  const envPrefix = env
    ? `${Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")} `
    : "";
  const cmd = `${envPrefix}bun --preload=${PRELOAD} ${TUI_SCRIPT} usage${argStr}`;
  await runTmux(["send-keys", "-t", sessionName, cmd, "Enter"]);
}

/** Capture the current frame from a tmux session. */
export async function captureFrame(sessionName: string): Promise<string> {
  const { stdout } = await runTmux(["capture-pane", "-t", sessionName, "-p"], { capture: true, suppressErrors: true });
  return stdout;
}

/** Send a named key to a tmux session (e.g., "q", "Escape", "?"). */
export async function sendKey(sessionName: string, key: string): Promise<void> {
  // Use -l flag for single printable chars, named keys otherwise
  const namedKeys = ["Escape", "Enter", "Tab", "Up", "Down", "Left", "Right", "Space"];
  if (namedKeys.includes(key)) {
    await runTmux(["send-keys", "-t", sessionName, key, ""]);
  } else {
    // Literal single chars (q, p, r, ?, j, k, [, ], +, -, 1, 2, etc.)
    await runTmux(["send-keys", "-t", sessionName, "-l", key]);
  }
  await Bun.sleep(200);
}

/** Send a raw key string (no Enter). */
export async function sendRawKey(sessionName: string, key: string): Promise<void> {
  await runTmux(["send-keys", "-t", sessionName, "-l", key]);
}

/** Kill a tmux session. */
export async function killSession(sessionName: string): Promise<void> {
  await runTmux(["kill-session", "-t", sessionName], { suppressErrors: true });
}

/** Check if a tmux session exists. */
export async function sessionExists(sessionName: string): Promise<boolean> {
  const { exitCode } = await runTmux(["has-session", "-t", sessionName], { suppressErrors: true });
  return exitCode === 0;
}

/** Resize a tmux session window. */
export async function resizeSession(sessionName: string, width: number, height: number): Promise<void> {
  await runTmux(["resize-window", "-t", sessionName, "-x", String(width), "-y", String(height)]);
}

/**
 * Poll tmux session until frame contains marker text, or timeout.
 * Returns the frame when found, or last captured frame on timeout.
 */
export async function waitForContent(
  sessionName: string,
  marker: string,
  timeoutMs = 20000,
  intervalMs = 500,
): Promise<string> {
  let elapsed = 0;
  let frame = "";
  while (elapsed < timeoutMs) {
    await Bun.sleep(intervalMs);
    elapsed += intervalMs;
    frame = await captureFrame(sessionName);
    if (frame.includes(marker)) return frame;
  }
  return frame;
}

/**
 * Wait for a session to disappear (e.g., after `q` to quit).
 * Returns true if session is gone within timeout.
 */
export async function waitForSessionExit(sessionName: string, timeoutMs = 5000, intervalMs = 200): Promise<boolean> {
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    await Bun.sleep(intervalMs);
    elapsed += intervalMs;
    if (!(await sessionExists(sessionName))) return true;
  }
  return false;
}

/** Get the PID of the process running in a tmux session pane. */
export async function getPanePid(sessionName: string): Promise<number | null> {
  const { stdout } = await runTmux(["list-panes", "-t", sessionName, "-F", "#{pane_pid}"], {
    capture: true,
    suppressErrors: true,
  });
  const pid = parseInt(stdout.trim(), 10);
  return Number.isNaN(pid) ? null : pid;
}

/** Get process RSS (KB) for a given PID. Returns null if process not found. */
export async function getProcessRSS(pid: number): Promise<number | null> {
  const proc = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]);
  if (proc.exitCode !== 0) return null;
  const rss = parseInt(proc.stdout.toString().trim(), 10);
  return Number.isNaN(rss) ? null : rss;
}
