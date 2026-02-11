/**
 * Credential discovery for Claude and Codex APIs.
 * Port of src/providers/credentials.py
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import type { ClaudeCredentials, CodexCredentials } from "../types.js";

/** Manages Claude credential discovery from Keychain and file */
export class ClaudeCredentialStore {
  static readonly KEYCHAIN_SERVICE = "Claude Code-credentials";
  static readonly CREDENTIALS_FILE = join(homedir(), ".claude", ".credentials.json");

  private _credentials: ClaudeCredentials | null = null;

  getCredentials(): ClaudeCredentials | null {
    if (this._credentials !== null) {
      return this._credentials;
    }

    // Try Keychain first (macOS)
    const keychainCreds = this._getFromKeychain();
    if (keychainCreds !== null) {
      this._credentials = keychainCreds;
      return keychainCreds;
    }

    // Fallback to file
    const fileCreds = this._getFromFile();
    if (fileCreds !== null) {
      this._credentials = fileCreds;
      return fileCreds;
    }

    return null;
  }

  private _getFromKeychain(): ClaudeCredentials | null {
    try {
      const proc = Bun.spawnSync([
        "security", "find-generic-password",
        "-s", ClaudeCredentialStore.KEYCHAIN_SERVICE,
        "-w",
      ]);

      if (proc.exitCode !== 0) {
        return null;
      }

      const data = JSON.parse(proc.stdout.toString().trim());
      return this._parseCredentials(data);
    } catch {
      return null;
    }
  }

  private _getFromFile(): ClaudeCredentials | null {
    try {
      if (!existsSync(ClaudeCredentialStore.CREDENTIALS_FILE)) {
        return null;
      }

      const raw = readFileSync(ClaudeCredentialStore.CREDENTIALS_FILE, "utf-8");
      const data = JSON.parse(raw);
      return this._parseCredentials(data);
    } catch {
      return null;
    }
  }

  private _parseCredentials(data: Record<string, unknown>): ClaudeCredentials | null {
    try {
      const oauth = (data.claudeAiOauth ?? {}) as Record<string, unknown>;

      return {
        accessToken: (oauth.accessToken as string) ?? "",
        refreshToken: (oauth.refreshToken as string) ?? "",
        expiresAt: (oauth.expiresAt as number) ?? 0,
        subscriptionType: (oauth.subscriptionType as string) ?? "unknown",
        rateLimitTier: (oauth.rateLimitTier as string) ?? "unknown",
      };
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    const creds = this.getCredentials();
    if (creds === null) return false;

    // Check if token is expired (expiresAt is in milliseconds)
    if (creds.expiresAt / 1000 < Date.now() / 1000) return false;

    // Check if token has valid prefix
    if (!creds.accessToken.startsWith("sk-ant-oat01-")) return false;

    return true;
  }
}

/** Manages Codex credential discovery from file */
export class CodexCredentialStore {
  static readonly CREDENTIALS_FILE = join(homedir(), ".codex", "auth.json");

  private _credentials: CodexCredentials | null = null;

  getCredentials(): CodexCredentials | null {
    if (this._credentials !== null) {
      return this._credentials;
    }

    try {
      if (!existsSync(CodexCredentialStore.CREDENTIALS_FILE)) {
        return null;
      }

      const raw = readFileSync(CodexCredentialStore.CREDENTIALS_FILE, "utf-8");
      const data = JSON.parse(raw) as Record<string, unknown>;

      const tokens = (data.tokens ?? {}) as Record<string, unknown>;

      const creds: CodexCredentials = {
        accessToken: (tokens.access_token as string) ?? "",
        refreshToken: (tokens.refresh_token as string) ?? "",
        accountId: (tokens.account_id as string) ?? "",
        lastRefresh: (data.last_refresh as string) ?? "",
      };

      this._credentials = creds;
      return creds;
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    const creds = this.getCredentials();
    if (creds === null) return false;
    if (!creds.accessToken || !creds.refreshToken) return false;
    return true;
  }
}
