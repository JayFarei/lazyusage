/**
 * Direct PTY session management using openpty FFI.
 * Replaces tmux dependency for CLI interaction.
 * Uses macOS/Linux openpty() to allocate a pseudo-terminal pair,
 * then spawns the CLI with the secondary fd as stdin/stdout/stderr.
 */

import { cc, dlopen, FFIType, ptr } from "bun:ffi";
import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, readSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// -- Native FFI loading --

function loadOpenpty() {
  const libNames = process.platform === "darwin" ? ["libutil.dylib"] : ["libutil.so.1", "libutil.so", "libc.so.6"];

  for (const name of libNames) {
    try {
      return dlopen(name, {
        openpty: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
          returns: FFIType.i32,
        },
      });
    } catch {
      /* try next */
    }
  }
  return null;
}

let _setNonblock: ((fd: number) => number) | null = null;

function getSetNonblock(): (fd: number) => number {
  if (_setNonblock) return _setNonblock;

  const helperPath = join(dirname(fileURLToPath(import.meta.url)), "pty_helpers.c");
  const { symbols } = cc({
    source: helperPath,
    symbols: {
      set_fd_nonblock: { args: [FFIType.i32], returns: FFIType.i32 },
    },
  });
  _setNonblock = symbols.set_fd_nonblock as (fd: number) => number;
  return _setNonblock;
}

// -- PTY allocation --

interface PtyPair {
  primaryFd: number;
  secondaryFd: number;
}

function allocatePty(): PtyPair {
  const lib = loadOpenpty();
  if (!lib) throw new Error("openpty not available on this platform");

  const primaryBuf = new Int32Array(1);
  const secondaryBuf = new Int32Array(1);

  const result = lib.symbols.openpty(ptr(primaryBuf), ptr(secondaryBuf), null, null, null);

  lib.close();

  if (result !== 0) {
    throw new Error("openpty() failed");
  }

  // Set primary to non-blocking so drain loops don't block
  const setNonblock = getSetNonblock();
  setNonblock(primaryBuf[0]);

  return { primaryFd: primaryBuf[0], secondaryFd: secondaryBuf[0] };
}

// -- Low-level fd I/O --

const READ_BUF = new Uint8Array(16384);

/** Read available data from a non-blocking fd. Returns "" if no data / EAGAIN. */
function readFd(fd: number): string {
  try {
    const n = readSync(fd, READ_BUF, 0, READ_BUF.length, null);
    if (n <= 0) return "";
    return new TextDecoder().decode(READ_BUF.subarray(0, n));
  } catch {
    // EAGAIN or fd closed
    return "";
  }
}

function writeFd(fd: number, data: string): void {
  try {
    writeSync(fd, data);
  } catch {
    // fd may be closed
  }
}

/** Drain all currently available data from a non-blocking fd */
function drainFd(fd: number): string {
  let result = "";
  let chunk = readFd(fd);
  while (chunk.length > 0) {
    result += chunk;
    chunk = readFd(fd);
  }
  return result;
}

// -- Key mapping --

function mapSpecialKey(key: string): string {
  switch (key) {
    case "Enter":
      return "\r";
    case "Escape":
      return "\x1b";
    case "Tab":
      return "\t";
    case "Backspace":
      return "\x7f";
    default:
      return key;
  }
}

// -- Public session classes --

/** Ephemeral PTY session (single-shot, killed after use) */
export class DirectSession {
  readonly name: string;
  private command: string;
  private pty: PtyPair | null = null;
  private child: ChildProcess | null = null;
  private outputBuffer: string = "";

  constructor(name: string, command: string) {
    this.name = name;
    this.command = command;
  }

  async enter(): Promise<void> {
    await this.start();
  }

  async start(): Promise<void> {
    this.pty = allocatePty();

    this.child = spawn(this.command, ["--allowed-tools", ""], {
      stdio: [this.pty.secondaryFd, this.pty.secondaryFd, this.pty.secondaryFd],
    });

    // Close secondary fd in parent (child owns it now)
    try {
      closeSync(this.pty.secondaryFd);
    } catch {
      /* ignore */
    }

    // Wait for CLI to initialize
    await Bun.sleep(2000);

    // Drain initial output (prompts, banners)
    this.outputBuffer += drainFd(this.pty.primaryFd);
  }

  async sendKeys(keys: string, delay: number = 200, literal: boolean = false): Promise<void> {
    if (!this.pty) return;

    if (literal) {
      writeFd(this.pty.primaryFd, mapSpecialKey(keys));
    } else {
      for (const char of keys) {
        writeFd(this.pty.primaryFd, char);
        if (delay > 0) await Bun.sleep(delay);
      }
    }
    await Bun.sleep(500);
  }

  async captureOutput(): Promise<string> {
    if (this.pty) {
      this.outputBuffer += drainFd(this.pty.primaryFd);
    }
    return this.outputBuffer;
  }

  async waitForContent(marker: string, timeout: number = 8000, interval: number = 500): Promise<string> {
    let elapsed = 0;
    while (elapsed < timeout) {
      await Bun.sleep(interval);
      elapsed += interval;
      if (this.pty) {
        this.outputBuffer += drainFd(this.pty.primaryFd);
      }
      if (this.outputBuffer.includes(marker)) {
        return this.outputBuffer;
      }
    }
    return this.outputBuffer;
  }

  async cleanup(): Promise<void> {
    if (this.pty) {
      try {
        closeSync(this.pty.primaryFd);
      } catch {
        /* ignore */
      }
      this.pty = null;
    }
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.outputBuffer = "";
  }
}

/** Persistent PTY session (kept alive between refreshes) */
export class PersistentDirectSession {
  readonly name: string;
  private command: string;
  private pty: PtyPair | null = null;
  private child: ChildProcess | null = null;
  private outputBuffer: string = "";
  private sessionStarted: boolean = false;

  constructor(name: string, command: string) {
    this.name = name;
    this.command = command;
  }

  async windup(): Promise<void> {
    this.pty = allocatePty();

    this.child = spawn(this.command, ["--allowed-tools", ""], {
      stdio: [this.pty.secondaryFd, this.pty.secondaryFd, this.pty.secondaryFd],
    });

    try {
      closeSync(this.pty.secondaryFd);
    } catch {
      /* ignore */
    }

    await Bun.sleep(2000);
    if (this.pty) {
      this.outputBuffer += drainFd(this.pty.primaryFd);
    }
    this.sessionStarted = true;
  }

  async isAlive(): Promise<boolean> {
    if (!this.sessionStarted || !this.child) return false;
    return this.child.exitCode === null;
  }

  async sendKeys(keys: string, delay: number = 200, literal: boolean = false): Promise<void> {
    if (!this.pty) return;

    if (literal) {
      writeFd(this.pty.primaryFd, mapSpecialKey(keys));
    } else {
      for (const char of keys) {
        writeFd(this.pty.primaryFd, char);
        if (delay > 0) await Bun.sleep(delay);
      }
    }
    await Bun.sleep(500);
  }

  async captureOutput(): Promise<string> {
    if (this.pty) {
      this.outputBuffer += drainFd(this.pty.primaryFd);
    }
    return this.outputBuffer;
  }

  async waitForContent(marker: string, timeout: number = 8000, interval: number = 500): Promise<string> {
    let elapsed = 0;
    while (elapsed < timeout) {
      await Bun.sleep(interval);
      elapsed += interval;
      if (this.pty) {
        this.outputBuffer += drainFd(this.pty.primaryFd);
      }
      if (this.outputBuffer.includes(marker)) {
        return this.outputBuffer;
      }
    }
    return this.outputBuffer;
  }

  async winddown(): Promise<void> {
    if (this.sessionStarted) {
      // Try graceful exit
      if (this.pty) {
        try {
          writeFd(this.pty.primaryFd, "/exit\r");
        } catch {
          /* ignore */
        }
      }

      // Wait briefly for graceful exit
      const deadline = Date.now() + 1000;
      while (this.child?.exitCode === null && Date.now() < deadline) {
        await Bun.sleep(100);
      }

      if (this.pty) {
        try {
          closeSync(this.pty.primaryFd);
        } catch {
          /* ignore */
        }
        this.pty = null;
      }
      if (this.child) {
        if (this.child.exitCode === null) this.child.kill();
        this.child = null;
      }
      this.sessionStarted = false;
      this.outputBuffer = "";
    }
  }
}
