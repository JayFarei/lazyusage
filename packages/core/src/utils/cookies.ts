/**
 * Browser cookie extraction for claude.ai session keys.
 * macOS only - returns null on other platforms.
 *
 * Priority: Firefox (unencrypted) -> Chrome (encrypted via Keychain)
 */

import { Database } from "bun:sqlite";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SessionCookie {
  value: string;
  source: string;
}

const COOKIE_CACHE_TTL_MS = 5 * 60_000; // 5 minutes

let _cachedCookie: SessionCookie | null = null;
let _cachedAt = 0;

/** Get the claude.ai sessionKey cookie, with caching */
export function getClaudeSessionCookie(): SessionCookie | null {
  if (process.platform !== "darwin") return null;

  // Return cached if fresh
  if (_cachedCookie && Date.now() - _cachedAt < COOKIE_CACHE_TTL_MS) {
    return _cachedCookie;
  }

  const cookie = extractClaudeSessionCookie();
  if (cookie) {
    _cachedCookie = cookie;
    _cachedAt = Date.now();
  }
  return cookie;
}

/** Invalidate the cached cookie (call on 401) */
export function invalidateClaudeSessionCookie(): void {
  _cachedCookie = null;
  _cachedAt = 0;
}

/** Try all browsers in priority order */
function extractClaudeSessionCookie(): SessionCookie | null {
  return extractFromFirefox() ?? extractFromChrome();
}

// -- Firefox (unencrypted) --

function extractFromFirefox(): SessionCookie | null {
  try {
    const profilesDir = join(homedir(), "Library", "Application Support", "Firefox", "Profiles");

    if (!existsSync(profilesDir)) return null;

    // Find the default-release profile
    const profiles = readdirSync(profilesDir).filter((d) => d.endsWith(".default-release") || d.endsWith(".default"));
    if (profiles.length === 0) return null;

    for (const profile of profiles) {
      const cookieDb = join(profilesDir, profile, "cookies.sqlite");
      if (!existsSync(cookieDb)) continue;

      try {
        // Open read-only to avoid locking issues with running Firefox
        const db = new Database(cookieDb, { readonly: true });
        const row = db
          .query("SELECT value FROM moz_cookies WHERE host = '.claude.ai' AND name = 'sessionKey' LIMIT 1")
          .get() as { value: string } | null;
        db.close();

        if (row?.value?.startsWith("sk-ant-")) {
          return { value: row.value, source: "Firefox" };
        }
      } catch {}
    }

    return null;
  } catch {
    return null;
  }
}

// -- Chrome (encrypted) --

function extractFromChrome(): SessionCookie | null {
  try {
    const cookieDb = join(homedir(), "Library", "Application Support", "Google", "Chrome", "Default", "Cookies");

    if (!existsSync(cookieDb)) return null;

    // Get Chrome Safe Storage password from Keychain
    const encryptionKey = getChromeEncryptionKey();
    if (!encryptionKey) return null;

    const db = new Database(cookieDb, { readonly: true });
    const row = db
      .query("SELECT encrypted_value FROM cookies WHERE host_key = '.claude.ai' AND name = 'sessionKey' LIMIT 1")
      .get() as { encrypted_value: Uint8Array } | null;
    db.close();

    if (!row?.encrypted_value) return null;

    const decrypted = decryptChromeCookie(row.encrypted_value, encryptionKey);
    if (decrypted?.startsWith("sk-ant-")) {
      return { value: decrypted, source: "Chrome" };
    }

    return null;
  } catch {
    return null;
  }
}

function getChromeEncryptionKey(): Uint8Array | null {
  try {
    const proc = Bun.spawnSync(["/usr/bin/security", "find-generic-password", "-s", "Chrome Safe Storage", "-w"], {
      stdout: "pipe",
      stderr: "ignore",
    });

    if (proc.exitCode !== 0) return null;

    const password = proc.stdout.toString().trim();
    if (!password) return null;

    // Derive AES key using PBKDF2 (Chrome uses 1003 iterations, 16-byte key)
    const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
    return new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
  } catch {
    return null;
  }
}

function decryptChromeCookie(encrypted: Uint8Array, key: Uint8Array): string | null {
  try {
    // Chrome v10+ encrypted cookies start with 'v10' or 'v11'
    const version = new TextDecoder().decode(encrypted.slice(0, 3));
    if (version !== "v10" && version !== "v11") return null;

    // Try AES-128-GCM first (Chrome 80+: 3-byte prefix + 12-byte nonce + ciphertext + 16-byte tag)
    const gcmResult = decryptGCM(encrypted.slice(3), key);
    if (gcmResult) return gcmResult;

    // Fallback to AES-128-CBC (older Chrome: 3-byte prefix + ciphertext, IV = 16 spaces)
    const ciphertext = encrypted.slice(3);
    const iv = new Uint8Array(16).fill(0x20);
    const decipher = createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(true);

    const part1 = new Uint8Array(decipher.update(ciphertext));
    const part2 = new Uint8Array(decipher.final());
    const merged = new Uint8Array(part1.length + part2.length);
    merged.set(part1);
    merged.set(part2, part1.length);

    return new TextDecoder().decode(merged);
  } catch {
    return null;
  }
}

function decryptGCM(data: Uint8Array, key: Uint8Array): string | null {
  if (data.length < 28) return null; // need at least 12 nonce + 16 tag
  try {
    const nonce = data.slice(0, 12);
    const tag = data.slice(data.length - 16);
    const ciphertext = data.slice(12, data.length - 16);

    const decipher = createDecipheriv("aes-128-gcm", key, nonce);
    if (!("setAuthTag" in decipher) || typeof decipher.setAuthTag !== "function") {
      return null;
    }

    decipher.setAuthTag(tag);

    const part1 = new Uint8Array(decipher.update(ciphertext));
    const part2 = new Uint8Array(decipher.final());
    const merged = new Uint8Array(part1.length + part2.length);
    merged.set(part1);
    merged.set(part2, part1.length);

    const result = new TextDecoder().decode(merged);
    // Sanity check: should be printable ASCII
    if (/^[\x20-\x7e]+$/.test(result)) return result;
    return null;
  } catch {
    return null;
  }
}
