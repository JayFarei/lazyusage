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
  private _refreshInProgress = false;

  getCredentials(): ClaudeCredentials | null {
    if (this._credentials !== null) {
      return this._credentials;
    }

    // Env override (for testing and headless envs)
    const envFile = process.env.CLAUDE_CREDENTIALS_FILE;
    if (envFile) {
      const fileCreds = this._getFromFilePath(envFile);
      if (fileCreds !== null) {
        this._credentials = fileCreds;
        return fileCreds;
      }
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

  /** True if a sk-ant-ort01- refresh token is present (even when access token expired) */
  canRefresh(): boolean {
    const creds = this._getStaleCredentials();
    return creds?.refreshToken?.startsWith("sk-ant-ort01-") ?? false;
  }

  /**
   * Calls OAuth refresh endpoint. Updates in-memory creds and persists.
   * Returns true on success.
   * oauthUrl is injectable so tests can point it at a local mock server.
   */
  async tryRefreshToken(oauthUrl = "https://console.anthropic.com/api/oauth/token"): Promise<boolean> {
    if (this._refreshInProgress) return false;
    const creds = this._getStaleCredentials();
    if (!creds?.refreshToken?.startsWith("sk-ant-ort01-")) return false;

    this._refreshInProgress = true;
    try {
      const resp = await globalThis.fetch(oauthUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: creds.refreshToken,
          client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return false;
      const data = await resp.json() as Record<string, unknown>;
      this._credentials = {
        ...creds,
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string,
        expiresAt: Date.now() + ((data.expires_in as number) * 1000),
      };
      this._persistCredentials(this._credentials).catch(() => {});
      return true;
    } catch { return false; }
    finally { this._refreshInProgress = false; }
  }

  /**
   * Reads raw credentials bypassing expiry check.
   * Returns credentials struct even if access token is expired.
   */
  private _getStaleCredentials(): ClaudeCredentials | null {
    // If we have cached credentials (even expired), return them - refresh token is still valid
    if (this._credentials !== null) return this._credentials;
    // Otherwise read fresh from env file, Keychain, or file
    const envFile = process.env.CLAUDE_CREDENTIALS_FILE;
    if (envFile) {
      const result = this._getFromFilePath(envFile);
      if (result) return result;
    }
    const keychainCreds = this._getFromKeychain();
    if (keychainCreds) return keychainCreds;
    return this._getFromFile();
  }

  /**
   * Persists updated credentials back to their source.
   * Writes to CLAUDE_CREDENTIALS_FILE env override if set,
   * otherwise attempts Keychain, falling back to CREDENTIALS_FILE.
   */
  private async _persistCredentials(creds: ClaudeCredentials): Promise<void> {
    const payload = JSON.stringify({
      claudeAiOauth: {
        accessToken: creds.accessToken,
        refreshToken: creds.refreshToken,
        expiresAt: creds.expiresAt,
        subscriptionType: creds.subscriptionType,
        rateLimitTier: creds.rateLimitTier,
      },
    });

    // Env override file takes priority
    const envFile = process.env.CLAUDE_CREDENTIALS_FILE;
    if (envFile) {
      await Bun.write(envFile, payload);
      return;
    }

    // Try Keychain
    try {
      const proc = Bun.spawnSync([
        "security", "add-generic-password",
        "-s", ClaudeCredentialStore.KEYCHAIN_SERVICE,
        "-a", ClaudeCredentialStore.KEYCHAIN_SERVICE,
        "-w", payload,
        "-U",
      ]);
      if (proc.exitCode === 0) return;
    } catch { /* fall through to file */ }

    // Fall back to credentials file
    await Bun.write(ClaudeCredentialStore.CREDENTIALS_FILE, payload);
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

  private _getFromFilePath(filePath: string): ClaudeCredentials | null {
    try {
      if (!existsSync(filePath)) {
        return null;
      }

      const raw = readFileSync(filePath, "utf-8");
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
