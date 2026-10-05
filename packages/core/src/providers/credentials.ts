/**
 * Credential discovery for Claude, Codex and Grok APIs.
 * Port of src/providers/credentials.py
 */

import { chmodSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { API_TIMEOUT_MS } from "../constants.js";
import type { ClaudeCredentials, CodexCredentials, GrokCredentials } from "../types.js";

/**
 * Circuit breaker for OAuth token refresh.
 * Exponential backoff for transient errors (5m base, 6h max).
 * Terminal blocking for invalid_grant that auto-heals when credentials change on disk.
 */
export class RefreshFailureGate {
  private static readonly BASE_BACKOFF_MS = 5 * 60_000; // 5 minutes
  private static readonly MAX_BACKOFF_MS = 6 * 3600_000; // 6 hours

  private _consecutiveFailures = 0;
  private _blockedUntil = 0;
  private _terminalError = false;
  private _lastRefreshTokenHash = "";

  /** Check if a refresh attempt is currently allowed */
  canAttempt(currentRefreshToken: string): boolean {
    // Auto-heal: if the refresh token changed on disk, reset the gate
    const tokenHash = this._hashToken(currentRefreshToken);
    if (this._lastRefreshTokenHash && tokenHash !== this._lastRefreshTokenHash) {
      this.reset();
    }
    this._lastRefreshTokenHash = tokenHash;

    if (this._terminalError) return false;
    return Date.now() >= this._blockedUntil;
  }

  /** Record a successful refresh, resetting all state */
  recordSuccess(): void {
    this._consecutiveFailures = 0;
    this._blockedUntil = 0;
    this._terminalError = false;
  }

  /** Record a failed refresh. Terminal errors (invalid_grant) block permanently until credential change. */
  recordFailure(errorMessage: string): void {
    if (/invalid_grant/i.test(errorMessage)) {
      this._terminalError = true;
      return;
    }

    this._consecutiveFailures++;
    const backoff = Math.min(
      RefreshFailureGate.BASE_BACKOFF_MS * 2 ** (this._consecutiveFailures - 1),
      RefreshFailureGate.MAX_BACKOFF_MS,
    );
    this._blockedUntil = Date.now() + backoff;
  }

  /** Reset the gate (e.g., when credentials change) */
  reset(): void {
    this._consecutiveFailures = 0;
    this._blockedUntil = 0;
    this._terminalError = false;
  }

  /** Simple hash for token comparison */
  private _hashToken(token: string): string {
    // Use first and last 8 chars as a simple fingerprint
    if (token.length < 16) return token;
    return `${token.slice(0, 8)}...${token.slice(-8)}`;
  }
}

/** Manages Claude credential discovery from Keychain and file */
export class ClaudeCredentialStore {
  static readonly KEYCHAIN_SERVICE = "Claude Code-credentials";
  static readonly CREDENTIALS_FILE = join(homedir(), ".claude", ".credentials.json");

  private static readonly CREDENTIAL_TTL_MS = 60_000; // Re-read from Keychain/file at most once per minute

  private _credentials: ClaudeCredentials | null = null;
  private _lastReadAt = 0;
  private _refreshInProgress = false;
  private _refreshGate = new RefreshFailureGate();

  getCredentials(): ClaudeCredentials | null {
    const now = Date.now();
    // Return cached credentials if they're fresh AND not expired
    if (
      this._credentials !== null &&
      now - this._lastReadAt < ClaudeCredentialStore.CREDENTIAL_TTL_MS &&
      this._credentials.expiresAt > now
    ) {
      return this._credentials;
    }

    return this._readCredentials();
  }

  /** Read credentials from all sources (env, Keychain, file) */
  private _readCredentials(): ClaudeCredentials | null {
    // Env override (for testing and headless envs)
    const envFile = process.env.CLAUDE_CREDENTIALS_FILE;
    if (envFile) {
      const fileCreds = this._getFromFilePath(envFile);
      if (fileCreds !== null) {
        this._credentials = fileCreds;
        this._lastReadAt = Date.now();
        return fileCreds;
      }
    }

    // Try Keychain first (macOS)
    const keychainCreds = this._getFromKeychain();
    if (keychainCreds !== null) {
      this._credentials = keychainCreds;
      this._lastReadAt = Date.now();
      return keychainCreds;
    }

    // Fallback to file
    const fileCreds = this._getFromFile();
    if (fileCreds !== null) {
      this._credentials = fileCreds;
      this._lastReadAt = Date.now();
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

    if (!this._refreshGate.canAttempt(creds.refreshToken)) return false;

    this._refreshInProgress = true;
    try {
      const resp = await globalThis.fetch(oauthUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: creds.refreshToken,
          // The Claude CLI's public OAuth client_id (not a secret; shipped in
          // the official CLI). Required for the refresh_token grant.
          client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (!resp.ok) {
        const errorText = await resp.text().catch(() => `HTTP ${resp.status}`);
        this._refreshGate.recordFailure(errorText);
        return false;
      }
      const data = (await resp.json()) as Record<string, unknown>;
      this._credentials = {
        ...creds,
        accessToken: data.access_token as string,
        refreshToken: data.refresh_token as string,
        expiresAt: Date.now() + (data.expires_in as number) * 1000,
      };
      this._lastReadAt = Date.now();
      this._refreshGate.recordSuccess();
      this._persistCredentials(this._credentials).catch(() => {});
      return true;
    } catch (e) {
      this._refreshGate.recordFailure(e instanceof Error ? e.message : "unknown");
      return false;
    } finally {
      this._refreshInProgress = false;
    }
  }

  /**
   * Reads raw credentials bypassing expiry check.
   * Returns credentials struct even if access token is expired.
   * Re-reads from source when TTL has elapsed, so we pick up tokens
   * refreshed by the Claude CLI itself.
   */
  private _getStaleCredentials(): ClaudeCredentials | null {
    const now = Date.now();
    // Return cached credentials if TTL hasn't expired
    if (this._credentials !== null && now - this._lastReadAt < ClaudeCredentialStore.CREDENTIAL_TTL_MS) {
      return this._credentials;
    }
    // Re-read from sources (Keychain/file may have fresher tokens)
    return this._readCredentials() ?? this._credentials;
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
      chmodSync(envFile, 0o600);
      return;
    }

    // Try Keychain
    try {
      const proc = Bun.spawnSync([
        "/usr/bin/security",
        "add-generic-password",
        "-s",
        ClaudeCredentialStore.KEYCHAIN_SERVICE,
        "-a",
        ClaudeCredentialStore.KEYCHAIN_SERVICE,
        "-w",
        payload,
        "-U",
      ]);
      if (proc.exitCode === 0) return;
    } catch {
      /* fall through to file */
    }

    // Fall back to credentials file
    await Bun.write(ClaudeCredentialStore.CREDENTIALS_FILE, payload);
    chmodSync(ClaudeCredentialStore.CREDENTIALS_FILE, 0o600);
  }

  private static readonly KEYCHAIN_TIMEOUT_MS = 2000;

  private _getFromKeychain(): ClaudeCredentials | null {
    try {
      const proc = Bun.spawnSync([
        "/usr/bin/security",
        "find-generic-password",
        "-s",
        ClaudeCredentialStore.KEYCHAIN_SERVICE,
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

  /**
   * Async Keychain read with timeout.
   * Prevents blocking when macOS shows a Keychain authorization prompt.
   * Kills the security process if it doesn't respond within the timeout.
   */
  async _getFromKeychainAsync(): Promise<ClaudeCredentials | null> {
    try {
      const proc = Bun.spawn(
        ["/usr/bin/security", "find-generic-password", "-s", ClaudeCredentialStore.KEYCHAIN_SERVICE, "-w"],
        { stdout: "pipe", stderr: "ignore" },
      );

      const timeout = Bun.sleep(ClaudeCredentialStore.KEYCHAIN_TIMEOUT_MS).then(() => {
        proc.kill();
        return null as string | null;
      });

      const read = (async () => {
        const code = await proc.exited;
        if (code !== 0) return null;
        return await new Response(proc.stdout).text();
      })();

      const output = await Promise.race([read, timeout]);
      if (!output) return null;

      const data = JSON.parse(output.trim());
      return this._parseCredentials(data);
    } catch {
      return null;
    }
  }

  /**
   * Background Keychain refresh. Call after construction or on TTL expiry.
   * Populates the in-memory cache without blocking the caller.
   */
  refreshKeychainInBackground(): void {
    this._getFromKeychainAsync()
      .then((creds) => {
        if (creds !== null) {
          this._credentials = creds;
          this._lastReadAt = Date.now();
        }
      })
      .catch(() => {});
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

/** Manages Codex credential discovery from file, with disk-based refresh */
export class CodexCredentialStore {
  static readonly CREDENTIALS_FILE = join(homedir(), ".codex", "auth.json");

  private static readonly DISK_READ_TTL_MS = 60_000; // Re-read from disk at most once per minute

  private _credentials: CodexCredentials | null = null;
  private _lastDiskReadAt = 0;

  getCredentials(): CodexCredentials | null {
    if (this._credentials !== null) {
      return this._credentials;
    }

    return this._readFromDisk();
  }

  /** True if a refresh token exists (uses TTL-cached disk read) */
  canRefresh(): boolean {
    const now = Date.now();
    if (this._credentials && now - this._lastDiskReadAt < CodexCredentialStore.DISK_READ_TTL_MS) {
      return (this._credentials.refreshToken?.length ?? 0) > 0;
    }
    const creds = this._readFromDisk();
    return (creds?.refreshToken?.length ?? 0) > 0;
  }

  /**
   * Re-reads credentials from disk. The Codex CLI auto-refreshes tokens
   * and writes them back to auth.json, so a disk re-read picks up fresh tokens.
   * Returns true if credentials were successfully refreshed.
   */
  async tryRefreshToken(): Promise<boolean> {
    this._credentials = null; // Clear cache to force disk re-read
    const creds = this._readFromDisk();
    return creds !== null && creds.accessToken.length > 0;
  }

  isAvailable(): boolean {
    const creds = this.getCredentials();
    if (creds === null) return false;
    if (!creds.accessToken || !creds.refreshToken) return false;
    return true;
  }

  private _readFromDisk(): CodexCredentials | null {
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
      this._lastDiskReadAt = Date.now();
      return creds;
    } catch {
      return null;
    }
  }
}

/** Grok Build state directory: `$GROK_HOME`, defaulting to `~/.grok` (same rule as the grok CLI). */
export function grokHome(): string {
  return process.env.GROK_HOME || join(homedir(), ".grok");
}

/**
 * Manages Grok Build credentials from `$GROK_HOME/auth.json`.
 *
 * The grok CLI refreshes its OIDC access token (~6h lifetime) in the background
 * and rewrites auth.json, so "refresh" here is a disk re-read, as for Codex.
 * We never write auth.json: grok guards it with its own lock file and rotates
 * the refresh token, so a concurrent write could sign the user out.
 */
export class GrokCredentialStore {
  private static readonly DISK_READ_TTL_MS = 60_000;

  private readonly _home: string;
  private _credentials: GrokCredentials | null = null;
  private _subscription: string | null = null;
  private _lastDiskReadAt = 0;

  constructor(home?: string) {
    this._home = home ?? grokHome();
  }

  get credentialsFile(): string {
    return join(this._home, "auth.json");
  }

  getCredentials(): GrokCredentials | null {
    if (this._credentials !== null && Date.now() - this._lastDiskReadAt < GrokCredentialStore.DISK_READ_TTL_MS) {
      return this._credentials;
    }
    return this._readFromDisk();
  }

  /** Display name of the plan (e.g. "X Premium") from grok's settings cache, or null. */
  getSubscription(): string | null {
    this.getCredentials();
    return this._subscription;
  }

  /** A disk re-read can pick up a token grok refreshed, as long as auth.json exists. */
  canRefresh(): boolean {
    return existsSync(this.credentialsFile);
  }

  async tryRefreshToken(): Promise<boolean> {
    this._credentials = null;
    const creds = this._readFromDisk();
    return creds !== null && this._isUsable(creds);
  }

  isAvailable(): boolean {
    const creds = this.getCredentials();
    return creds !== null && this._isUsable(creds);
  }

  private _isUsable(creds: GrokCredentials): boolean {
    if (!creds.accessToken) return false;
    return creds.expiresAt === 0 || creds.expiresAt > Date.now();
  }

  private _readFromDisk(): GrokCredentials | null {
    try {
      if (!existsSync(this.credentialsFile)) return null;

      // auth.json maps "<issuer>::<client_id>" to an OIDC session; prefer the one that expires last.
      const data = JSON.parse(readFileSync(this.credentialsFile, "utf-8")) as Record<string, unknown>;
      let creds: GrokCredentials | null = null;
      for (const entry of Object.values(data)) {
        if (entry === null || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        if (typeof record.key !== "string" || record.key.length === 0) continue;
        const parsed = typeof record.expires_at === "string" ? Date.parse(record.expires_at) : Number.NaN;
        // Unknown expiry (0) is treated as non-expiring, so it ranks above any timestamp
        const expiresAt = Number.isFinite(parsed) ? parsed : 0;
        const rank = (c: GrokCredentials) => (c.expiresAt === 0 ? Number.POSITIVE_INFINITY : c.expiresAt);
        const candidate = { accessToken: record.key, expiresAt };
        if (creds === null || rank(candidate) > rank(creds)) creds = candidate;
      }

      this._credentials = creds;
      this._subscription = this._readSubscription();
      this._lastDiskReadAt = Date.now();
      return creds;
    } catch {
      return null;
    }
  }

  /** settings_cache.json wraps the server settings as a JSON string in `payload`. */
  private _readSubscription(): string | null {
    try {
      const file = join(this._home, "settings_cache.json");
      if (!existsSync(file)) return null;
      const cache = JSON.parse(readFileSync(file, "utf-8")) as { payload?: unknown };
      const payload = (typeof cache.payload === "string" ? JSON.parse(cache.payload) : cache.payload) as {
        settings?: { subscription_tier_display?: unknown };
      } | null;
      const display = payload?.settings?.subscription_tier_display;
      return typeof display === "string" && display.length > 0 ? display : null;
    } catch {
      return null;
    }
  }
}
