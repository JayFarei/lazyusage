/**
 * Grok Bot weekly allowance.
 *
 * The desktop app reports this through Cursor's Connect-RPC method
 * `aiserver.v1.DashboardService/GetSandUsageStatus`. It is a second pool on
 * accounts that have not moved onto the shared X Subscription allowance.
 * `isUnified: true` means Bot draws from the same pool as Grok, so the bar
 * is omitted rather than counted twice.
 *
 * The session lives in the app's `sand-secrets.json` (Chromium safeStorage).
 * The Keychain password decrypts it. This module never writes that file.
 * A refreshed access token is kept in lazyusage's own cache.
 */

import { execFile } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { API_TIMEOUT_MS } from "../constants.js";
import type { MetricData } from "../types.js";
import { formatResetFromIso } from "../utils/time.js";

const execFileAsync = promisify(execFile);

const USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus";
const TOKEN_URL = "https://api2.cursor.sh/oauth/token";
/** Public installed-app client id. It ships in Cursor's own CLI. */
const OAUTH_CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";

const SAFE_STORAGE_SALT = "saltysalt";
const SAFE_STORAGE_ITERATIONS = 1003;

export type GrokBotAllowance =
  | { show: true; metric: MetricData }
  | { show: false; reason: "unified" | "no-allowance" | "unreadable" | "unavailable" };

interface GrokBotSession {
  accessToken: string;
  refreshToken: string | null;
  /** Hash of the ciphertext in sand-secrets.json. A re-login changes it. */
  fingerprint: string;
}

interface CachedSession {
  fingerprint: string;
  accessToken: string;
  refreshToken: string | null;
}

export function grokBotSupportDir(): string {
  if (process.env.GROK_BOT_SUPPORT_DIR) return process.env.GROK_BOT_SUPPORT_DIR;
  if (process.platform === "darwin") return join(homedir(), "Library/Application Support/Grok Bot");
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "Grok Bot");
}

export function grokBotSessionCachePath(): string {
  return join(homedir(), ".cache", "lazyusage", "grok-bot-session.json");
}

function field(obj: Record<string, unknown>, camel: string, snake: string): unknown {
  return camel in obj ? obj[camel] : obj[snake];
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asPercent(value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded < 0 || rounded > 100) return null;
  return rounded;
}

/**
 * A separate Bot allowance, or a reason to leave the bar off.
 * A missing `usagePercent` is 0% (proto3 omits zeros). A missing reset, or a
 * percent that is not a 0-100 number, is unreadable rather than a guessed bar.
 */
export function classifyGrokBotUsage(data: unknown): GrokBotAllowance {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { show: false, reason: "unreadable" };
  const body = data as Record<string, unknown>;

  if (asBool(field(body, "isUnified", "is_unified")) === true) return { show: false, reason: "unified" };
  if (asBool(field(body, "includedLimitZero", "included_limit_zero")) === true) {
    return { show: false, reason: "no-allowance" };
  }
  if (asBool(field(body, "usesPooledEnterpriseAllowance", "uses_pooled_enterprise_allowance")) === true) {
    return { show: false, reason: "no-allowance" };
  }
  if (asBool(field(body, "hasNonZeroIncludedLimit", "has_non_zero_included_limit")) !== true) {
    return { show: false, reason: "no-allowance" };
  }

  const percentField = field(body, "usagePercent", "usage_percent");
  const used = percentField === undefined ? 0 : asPercent(percentField);
  if (used === null) return { show: false, reason: "unreadable" };

  const resetRaw = field(body, "nextResetTimestampUtc", "next_reset_timestamp_utc");
  if (typeof resetRaw !== "string" || Number.isNaN(new Date(resetRaw).getTime())) {
    return { show: false, reason: "unreadable" };
  }

  return {
    show: true,
    metric: { used_pct: used, remaining_pct: 100 - used, resets: formatResetFromIso(resetRaw) },
  };
}

/** Decode a safeStorage blob: raw base64 of a `v10` payload, or `scoped:v1:<scope>:<base64>`. */
export function decodeSafeStorageBlob(stored: string): Buffer {
  const payload = stored.startsWith("scoped:v1:") ? stored.slice(stored.indexOf(":", "scoped:v1:".length) + 1) : stored;
  const raw = Buffer.from(payload, "base64");
  if (raw.subarray(0, 3).toString("utf8") !== "v10") {
    throw new Error("Grok Bot secret is not a v10 safeStorage blob");
  }
  return raw;
}

/** Decrypt a Chromium safeStorage `v10` secret with the Keychain password. */
export function decryptSafeStorage(stored: string, password: string): string {
  const raw = decodeSafeStorageBlob(stored);
  const derived = pbkdf2Sync(password, SAFE_STORAGE_SALT, SAFE_STORAGE_ITERATIONS, 16, "sha1");
  const key = new Uint8Array(derived.buffer, derived.byteOffset, derived.byteLength);
  const iv = new Uint8Array(16).fill(0x20);
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  const part1 = new Uint8Array(decipher.update(new Uint8Array(raw.subarray(3))));
  const part2 = new Uint8Array(decipher.final());
  const merged = new Uint8Array(part1.length + part2.length);
  merged.set(part1);
  merged.set(part2, part1.length);
  return new TextDecoder().decode(merged);
}

function parseAccounts(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

/** The active account's access and refresh ciphertexts, or the legacy single-token fields. */
export function grokBotCiphertexts(secrets: unknown): { access: string; refresh: string | null } | null {
  if (secrets === null || typeof secrets !== "object") return null;
  const root = secrets as Record<string, unknown>;

  const accounts = parseAccounts(root["cursor-accounts"]);
  if (accounts) {
    const map = accounts.accounts;
    if (map !== null && typeof map === "object" && !Array.isArray(map)) {
      const entries = map as Record<string, unknown>;
      const active = typeof accounts.active === "string" ? entries[accounts.active] : undefined;
      const chosen =
        active !== null && typeof active === "object"
          ? active
          : Object.keys(entries).length === 1
            ? Object.values(entries)[0]
            : undefined;
      if (chosen !== null && typeof chosen === "object") {
        const record = chosen as Record<string, unknown>;
        const access = record["cursor-access-token"];
        if (typeof access === "string" && access.length > 0) {
          const refresh = record["cursor-refresh-token"];
          return { access, refresh: typeof refresh === "string" && refresh.length > 0 ? refresh : null };
        }
      }
    }
  }

  const access = root["cursor-access-token"];
  if (typeof access !== "string" || access.length === 0) return null;
  const refresh = root["cursor-refresh-token"];
  return { access, refresh: typeof refresh === "string" && refresh.length > 0 ? refresh : null };
}

let keychainDenied = false;
let cachedPassword: string | null = null;

/** `security list-keychains` prints one quoted path per line. */
export function parseSecurityKeychainList(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.endsWith(".keychain") || line.endsWith(".keychain-db"));
}

/**
 * The login item is invisible when the default keychain is the system keychain.
 * Pass the user keychain files so `security` does not search only that default.
 */
export function grokBotKeychainArgs(keychains: string[]): string[] {
  return ["find-generic-password", "-s", "Grok Bot Safe Storage", "-a", "Grok Bot Key", "-w", ...keychains];
}

async function userKeychainPaths(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/security", ["list-keychains", "-d", "user"], { timeout: 5_000 });
    const listed = parseSecurityKeychainList(stdout);
    if (listed.length > 0) return listed;
  } catch {
    // Fall through to the login keychain file.
  }
  return [
    join(homedir(), "Library/Keychains/login.keychain-db"),
    join(homedir(), "Library/Keychains/login.keychain"),
  ].filter((path) => existsSync(path));
}

async function readKeychainPassword(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  if (keychainDenied) return null;
  if (cachedPassword !== null) return cachedPassword;
  try {
    const keychains = await userKeychainPaths();
    if (keychains.length === 0) {
      keychainDenied = true;
      return null;
    }
    const { stdout } = await execFileAsync("/usr/bin/security", grokBotKeychainArgs(keychains), { timeout: 60_000 });
    const password = stdout.replace(/\n$/, "");
    if (password.length === 0) {
      keychainDenied = true;
      return null;
    }
    cachedPassword = password;
    return password;
  } catch {
    keychainDenied = true;
    return null;
  }
}

function readCache(path: string, fingerprint: string): CachedSession | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CachedSession>;
    if (
      parsed.fingerprint !== fingerprint ||
      typeof parsed.accessToken !== "string" ||
      parsed.accessToken.length === 0
    ) {
      return null;
    }
    return {
      fingerprint,
      accessToken: parsed.accessToken,
      refreshToken:
        typeof parsed.refreshToken === "string" && parsed.refreshToken.length > 0 ? parsed.refreshToken : null,
    };
  } catch {
    return null;
  }
}

function writeCache(path: string, session: CachedSession): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(session), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // The file is already created owner-only. A chmod failure leaves that mode in place.
  }
}

function clientVersion(supportDir: string): string {
  try {
    const status = JSON.parse(readFileSync(join(supportDir, "desktop-status.json"), "utf8")) as {
      appVersion?: unknown;
    };
    if (typeof status.appVersion === "string" && status.appVersion.length > 0) return status.appVersion;
  } catch {
    // The usage call accepts the header without a matching app build.
  }
  return "0.0.0";
}

/** Anything that can supply the Bot bar. The provider depends on this, not the client class. */
export interface GrokBotMetricSource {
  metric(): Promise<MetricData | null>;
}

export interface GrokBotClientOptions {
  supportDir?: string;
  cachePath?: string;
  fetch?: typeof fetch;
  /** Test seam. Production reads sand-secrets.json and the Keychain. */
  loadSession?: () => Promise<GrokBotSession | null>;
  readPassword?: () => Promise<string | null>;
}

/** Read-only client for the Grok Bot weekly allowance. */
export class GrokBotClient {
  private readonly supportDir: string;
  private readonly cachePath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly loadSession: () => Promise<GrokBotSession | null>;

  constructor(options: GrokBotClientOptions = {}) {
    this.supportDir = options.supportDir ?? grokBotSupportDir();
    this.cachePath = options.cachePath ?? grokBotSessionCachePath();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    const readPassword = options.readPassword ?? readKeychainPassword;
    this.loadSession = options.loadSession ?? (() => this.sessionFromDisk(readPassword));
  }

  /** The Bot bar when it is a separate allowance, otherwise null. */
  async metric(): Promise<MetricData | null> {
    const allowance = await this.allowance();
    return allowance.show ? allowance.metric : null;
  }

  async allowance(): Promise<GrokBotAllowance> {
    try {
      const session = await this.loadSession();
      if (session === null || session.accessToken.length === 0) return { show: false, reason: "unavailable" };

      let access = session.accessToken;
      let refresh = session.refreshToken;
      let response = await this.postUsage(access);
      if ((response.status === 401 || response.status === 403) && refresh) {
        const rotated = await this.refresh(refresh);
        if (rotated === null) return { show: false, reason: "unavailable" };
        access = rotated.accessToken;
        refresh = rotated.refreshToken ?? refresh;
        response = await this.postUsage(access);
      }
      if (!response.ok) return { show: false, reason: "unavailable" };

      const allowance = classifyGrokBotUsage(await response.json());
      if (allowance.show) {
        try {
          writeCache(this.cachePath, { fingerprint: session.fingerprint, accessToken: access, refreshToken: refresh });
        } catch {
          // A cache miss next time re-reads the app session. The reading itself stands.
        }
      }
      return allowance;
    } catch {
      return { show: false, reason: "unavailable" };
    }
  }

  private async sessionFromDisk(readPassword: () => Promise<string | null>): Promise<GrokBotSession | null> {
    let secrets: unknown;
    try {
      secrets = JSON.parse(readFileSync(join(this.supportDir, "sand-secrets.json"), "utf8"));
    } catch {
      return null;
    }
    const ciphers = grokBotCiphertexts(secrets);
    if (ciphers === null) return null;
    const fingerprint = createHash("sha256").update(ciphers.access).digest("hex");
    const cached = readCache(this.cachePath, fingerprint);
    if (cached !== null) return cached;
    const password = await readPassword();
    if (password === null) return null;
    try {
      return {
        accessToken: decryptSafeStorage(ciphers.access, password),
        refreshToken: ciphers.refresh ? decryptSafeStorage(ciphers.refresh, password) : null,
        fingerprint,
      };
    } catch {
      return null;
    }
  }

  private async postUsage(accessToken: string): Promise<Response> {
    return this.fetchImpl(USAGE_URL, {
      method: "POST",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-cursor-client-type": "sand",
        "x-cursor-client-version": clientVersion(this.supportDir),
        "x-sand-box-namespace": "prod",
      },
      body: "{}",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  }

  private async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string | null } | null> {
    const response = await this.fetchImpl(TOKEN_URL, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: OAUTH_CLIENT_ID, grant_type: "refresh_token", refresh_token: refreshToken }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { access_token?: unknown; refresh_token?: unknown };
    if (typeof body.access_token !== "string" || body.access_token.length === 0) return null;
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" && body.refresh_token.length > 0 ? body.refresh_token : null,
    };
  }
}
