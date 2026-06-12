/**
 * Tmux session management utilities.
 * Ported from Python src/utils/tmux.py
 */

async function runTmux(
  args: string[],
  options?: { captureOutput?: boolean; suppressErrors?: boolean },
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(["tmux", ...args], {
    stdout: options?.captureOutput ? "pipe" : "ignore",
    stderr: options?.suppressErrors ? "ignore" : "pipe",
  });

  let stdout = "";
  if (options?.captureOutput && proc.stdout) {
    stdout = await new Response(proc.stdout).text();
  }

  const exitCode = await proc.exited;
  return { exitCode, stdout };
}

/** Session names created by the usage collectors: <service>-<kind>-<pid> */
const USAGE_SESSION_PATTERN = /^(claude|codex)-(usage|live)-(\d+)$/;

/** Sessions created by this process, killed via exit hook if not cleaned up. */
const liveSessions = new Set<string>();
let exitHookInstalled = false;

function killSessionSync(name: string): void {
  Bun.spawnSync(["tmux", "kill-session", "-t", name], { stdout: "ignore", stderr: "ignore" });
}

function trackSession(name: string): void {
  liveSessions.add(name);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Async handlers do not run during exit, so kill synchronously.
    process.on("exit", () => {
      for (const session of liveSessions) killSessionSync(session);
    });
  }
}

function untrackSession(name: string): void {
  liveSessions.delete(name);
}

/**
 * Fail fast when the CLI a session would run is not installed. Otherwise the
 * session is created, the command dies instantly, and the collector spends
 * ~12s typing into and polling a dead session before giving up (the exact
 * behavior that made CI runs with tmux but no claude/codex time out).
 */
function assertCommandExists(command: string): void {
  const executable = command.split(/\s+/)[0];
  if (!Bun.which(executable)) {
    throw new Error(`${executable} not found in PATH`);
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill leftover collector sessions whose owning process is gone.
 *
 * Session names embed the creating pid, so sessions leaked by crashed or
 * force-killed runs (e.g. a closed tmux popup) can be reaped on the next run.
 * Returns the number of sessions killed; safe to call when tmux is absent.
 */
export async function sweepStaleUsageSessions(): Promise<number> {
  const { exitCode, stdout } = await runTmux(["list-sessions", "-F", "#{session_name}"], {
    captureOutput: true,
    suppressErrors: true,
  });
  if (exitCode !== 0) return 0;

  let killed = 0;
  for (const name of stdout.split("\n")) {
    const match = USAGE_SESSION_PATTERN.exec(name.trim());
    if (!match) continue;
    const pid = Number(match[3]);
    if (pid === process.pid || isPidAlive(pid)) continue;
    await runTmux(["kill-session", "-t", name.trim()], { suppressErrors: true });
    killed++;
  }
  return killed;
}

export class EphemeralSession {
  private sessionName: string;
  private command: string;

  constructor(sessionName: string, command: string) {
    this.sessionName = sessionName;
    this.command = command;
  }

  /** Alias used by collectors */
  async enter(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    assertCommandExists(this.command);
    await sweepStaleUsageSessions();
    await runTmux(["new-session", "-d", "-s", this.sessionName, this.command]);
    trackSession(this.sessionName);
    await Bun.sleep(2000);
  }

  async sendKeys(keys: string, delay: number = 200, literal: boolean = false): Promise<void> {
    if (literal) {
      await runTmux(["send-keys", "-t", this.sessionName, keys]);
    } else {
      for (const char of keys) {
        await runTmux(["send-keys", "-t", this.sessionName, "-l", char]);
        await Bun.sleep(delay);
      }
    }
    await Bun.sleep(500);
  }

  async captureOutput(): Promise<string> {
    const { stdout } = await runTmux(["capture-pane", "-t", this.sessionName, "-p", "-S", "-"], {
      captureOutput: true,
    });
    return stdout;
  }

  async waitForContent(marker: string, timeout: number = 8000, interval: number = 500): Promise<string> {
    let elapsed = 0;
    let output = "";
    while (elapsed < timeout) {
      await Bun.sleep(interval);
      elapsed += interval;
      output = await this.captureOutput();
      if (output.includes(marker)) {
        return output;
      }
    }
    return output;
  }

  async cleanup(): Promise<void> {
    await runTmux(["kill-session", "-t", this.sessionName], { suppressErrors: true });
    untrackSession(this.sessionName);
  }
}

export class PersistentSession {
  private sessionName: string;
  private command: string;
  private sessionStarted: boolean = false;

  constructor(sessionName: string, command: string) {
    this.sessionName = sessionName;
    this.command = command;
  }

  async windup(): Promise<void> {
    assertCommandExists(this.command);
    await sweepStaleUsageSessions();
    await runTmux(["new-session", "-d", "-s", this.sessionName, this.command]);
    trackSession(this.sessionName);
    await Bun.sleep(2000);
    this.sessionStarted = true;
  }

  async isAlive(): Promise<boolean> {
    if (!this.sessionStarted) return false;
    const { exitCode } = await runTmux(["has-session", "-t", this.sessionName], {
      captureOutput: true,
      suppressErrors: true,
    });
    return exitCode === 0;
  }

  async sendKeys(keys: string, delay: number = 200, literal: boolean = false): Promise<void> {
    if (literal) {
      await runTmux(["send-keys", "-t", this.sessionName, keys]);
    } else {
      for (const char of keys) {
        await runTmux(["send-keys", "-t", this.sessionName, "-l", char]);
        await Bun.sleep(delay);
      }
    }
    await Bun.sleep(500);
  }

  async captureOutput(): Promise<string> {
    const { stdout } = await runTmux(["capture-pane", "-t", this.sessionName, "-p", "-S", "-"], {
      captureOutput: true,
    });
    return stdout;
  }

  async waitForContent(marker: string, timeout: number = 8000, interval: number = 500): Promise<string> {
    let elapsed = 0;
    let output = "";
    while (elapsed < timeout) {
      await Bun.sleep(interval);
      elapsed += interval;
      output = await this.captureOutput();
      if (output.includes(marker)) {
        return output;
      }
    }
    return output;
  }

  async winddown(): Promise<void> {
    if (this.sessionStarted) {
      await runTmux(["kill-session", "-t", this.sessionName], { suppressErrors: true });
      untrackSession(this.sessionName);
      this.sessionStarted = false;
    }
  }
}
