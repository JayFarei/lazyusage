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
    await runTmux([
      "new-session", "-d", "-s", this.sessionName, this.command,
    ]);
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
    const { stdout } = await runTmux(
      ["capture-pane", "-t", this.sessionName, "-p", "-S", "-"],
      { captureOutput: true },
    );
    return stdout;
  }

  async waitForContent(
    marker: string,
    timeout: number = 8000,
    interval: number = 500,
  ): Promise<string> {
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
    await runTmux(
      ["kill-session", "-t", this.sessionName],
      { suppressErrors: true },
    );
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
    await runTmux([
      "new-session", "-d", "-s", this.sessionName, this.command,
    ]);
    await Bun.sleep(2000);
    this.sessionStarted = true;
  }

  async isAlive(): Promise<boolean> {
    if (!this.sessionStarted) return false;
    const { exitCode } = await runTmux(
      ["has-session", "-t", this.sessionName],
      { captureOutput: true, suppressErrors: true },
    );
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
    const { stdout } = await runTmux(
      ["capture-pane", "-t", this.sessionName, "-p", "-S", "-"],
      { captureOutput: true },
    );
    return stdout;
  }

  async waitForContent(
    marker: string,
    timeout: number = 8000,
    interval: number = 500,
  ): Promise<string> {
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
      await runTmux(
        ["kill-session", "-t", this.sessionName],
        { suppressErrors: true },
      );
      this.sessionStarted = false;
    }
  }
}
