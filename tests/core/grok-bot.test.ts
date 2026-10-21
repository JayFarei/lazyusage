/**
 * Grok Bot allowance: separate from the Grok weekly pool, hidden when unified.
 * Decryption and HTTP are exercised with fixtures. The Keychain is never contacted.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyGrokBotUsage,
  decryptSafeStorage,
  GrokBotClient,
  grokBotCiphertexts,
  grokBotKeychainArgs,
  parseSecurityKeychainList,
} from "../../packages/core/src/providers/grok-bot.js";

const PASSWORD = "keychain-password";

function seal(plain: string, password = PASSWORD): string {
  const derived = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const key = new Uint8Array(derived.byteLength);
  key.set(derived);
  const iv = new Uint8Array(16).fill(0x20);
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  const prefix = new TextEncoder().encode("v10");
  const part1 = new Uint8Array(cipher.update(plain, "utf8"));
  const part2 = new Uint8Array(cipher.final());
  const merged = new Uint8Array(prefix.length + part1.length + part2.length);
  merged.set(prefix);
  merged.set(part1, prefix.length);
  merged.set(part2, prefix.length + part1.length);
  return Buffer.from(merged).toString("base64");
}

function separateBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    currentPeriodStart: "2026-10-14T15:00:00.000Z",
    nextResetTimestampUtc: "2026-10-28T15:00:00.000Z",
    usagePercent: 19.15,
    hasNonZeroIncludedLimit: true,
    hasAvailableUsage: true,
    isUnified: false,
    ...overrides,
  };
}

describe("classifyGrokBotUsage", () => {
  test("maps a separate weekly allowance to a bot metric", () => {
    const reset = new Date("2026-10-28T15:00:00.000Z");
    const hour = reset.getHours();
    const displayHour = hour % 12 || 12;
    const period = hour >= 12 ? "pm" : "am";
    const allowance = classifyGrokBotUsage(separateBody());
    expect(allowance).toEqual({
      show: true,
      metric: {
        used_pct: 19,
        remaining_pct: 81,
        resets: `Oct ${reset.getDate()} at ${displayHour}:00${period}`,
      },
    });
  });

  test("treats an omitted usage percent as 0%", () => {
    const body = separateBody();
    delete body.usagePercent;
    const allowance = classifyGrokBotUsage(body);
    expect(allowance.show).toBe(true);
    if (allowance.show) expect(allowance.metric.used_pct).toBe(0);
  });

  test("hides the bar when Bot shares the Grok pool", () => {
    expect(classifyGrokBotUsage(separateBody({ isUnified: true }))).toEqual({ show: false, reason: "unified" });
  });

  test("hides the bar when the plan includes no Bot allowance", () => {
    expect(classifyGrokBotUsage(separateBody({ hasNonZeroIncludedLimit: false }))).toEqual({
      show: false,
      reason: "no-allowance",
    });
    expect(classifyGrokBotUsage(separateBody({ includedLimitZero: true }))).toEqual({
      show: false,
      reason: "no-allowance",
    });
    expect(classifyGrokBotUsage(separateBody({ usesPooledEnterpriseAllowance: true }))).toEqual({
      show: false,
      reason: "no-allowance",
    });
  });

  test("does not invent a bar when the reset or percent is unusable", () => {
    expect(classifyGrokBotUsage(separateBody({ nextResetTimestampUtc: "next tuesday" })).show).toBe(false);
    const body = separateBody();
    delete body.nextResetTimestampUtc;
    expect(classifyGrokBotUsage(body)).toEqual({ show: false, reason: "unreadable" });
    expect(classifyGrokBotUsage(separateBody({ usagePercent: 150 }))).toEqual({ show: false, reason: "unreadable" });
    expect(classifyGrokBotUsage(null)).toEqual({ show: false, reason: "unreadable" });
  });
});

describe("Grok Bot keychain lookup", () => {
  test("searches the user keychain list, because the default keychain may be the system one", () => {
    expect(parseSecurityKeychainList('    "/Users/me/Library/Keychains/login.keychain-db"\n')).toEqual([
      "/Users/me/Library/Keychains/login.keychain-db",
    ]);
    expect(grokBotKeychainArgs(["/Users/me/Library/Keychains/login.keychain-db"])).toEqual([
      "find-generic-password",
      "-s",
      "Grok Bot Safe Storage",
      "-a",
      "Grok Bot Key",
      "-w",
      "/Users/me/Library/Keychains/login.keychain-db",
    ]);
  });
});

describe("Grok Bot session secrets", () => {
  test("decrypts a v10 blob and the scoped:v1 envelope", () => {
    expect(decryptSafeStorage(seal("access-token"), PASSWORD)).toBe("access-token");
    expect(decryptSafeStorage(`scoped:v1:app:${seal("scoped-token")}`, PASSWORD)).toBe("scoped-token");
  });

  test("reads the active account from the cursor-accounts envelope", () => {
    const secrets = {
      "cursor-accounts": JSON.stringify({
        active: "second",
        accounts: {
          first: { "cursor-access-token": "old-access", "cursor-refresh-token": "old-refresh" },
          second: { "cursor-access-token": "live-access", "cursor-refresh-token": "live-refresh" },
        },
      }),
    };
    expect(grokBotCiphertexts(secrets)).toEqual({ access: "live-access", refresh: "live-refresh" });
  });

  test("reads the legacy single-token fields", () => {
    expect(grokBotCiphertexts({ "cursor-access-token": "only-access" })).toEqual({
      access: "only-access",
      refresh: null,
    });
  });
});

describe("GrokBotClient", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function workspace(): string {
    const dir = mkdtempSync(join(tmpdir(), "lazyusage-grok-bot-"));
    dirs.push(dir);
    return dir;
  }

  test("fetches a separate allowance with the app session and caches it", async () => {
    const dir = workspace();
    writeFileSync(
      join(dir, "sand-secrets.json"),
      JSON.stringify({
        "cursor-accounts": JSON.stringify({
          active: "acc",
          accounts: {
            acc: {
              "cursor-access-token": seal("access-token"),
              "cursor-refresh-token": seal("refresh-token"),
            },
          },
        }),
      }),
    );
    let passwordReads = 0;
    let calls = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls++;
      expect(url).toContain("GetSandUsageStatus");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
      expect(init?.body).toBe("{}");
      return new Response(JSON.stringify(separateBody({ usagePercent: 42 })), { status: 200 });
    }) as unknown as typeof fetch;

    const options = {
      supportDir: dir,
      cachePath: join(dir, "session.json"),
      fetch: fetchImpl,
      readPassword: async () => {
        passwordReads++;
        return PASSWORD;
      },
    };
    const first = await new GrokBotClient(options).metric();
    expect(first?.used_pct).toBe(42);
    expect(passwordReads).toBe(1);

    const second = await new GrokBotClient(options).metric();
    expect(second?.used_pct).toBe(42);
    expect(passwordReads).toBe(1);
    expect(calls).toBe(2);
  });

  test("refreshes once after a 401 and does not report a unified pool", async () => {
    const dir = workspace();
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      if (url.endsWith("/oauth/token")) {
        return new Response(JSON.stringify({ access_token: "rotated", refresh_token: "rotated-refresh" }), {
          status: 200,
        });
      }
      if (seen.filter((item) => item.includes("GetSandUsageStatus")).length === 1) {
        return new Response("{}", { status: 401 });
      }
      return new Response(JSON.stringify(separateBody({ isUnified: true, usagePercent: 12 })), { status: 200 });
    }) as unknown as typeof fetch;

    const allowance = await new GrokBotClient({
      supportDir: dir,
      cachePath: join(dir, "session.json"),
      fetch: fetchImpl,
      loadSession: async () => ({ accessToken: "stale", refreshToken: "refresh", fingerprint: "fp" }),
    }).allowance();

    expect(allowance).toEqual({ show: false, reason: "unified" });
    expect(seen.some((url) => url.endsWith("/oauth/token"))).toBe(true);
    expect(seen.filter((url) => url.includes("GetSandUsageStatus"))).toHaveLength(2);
  });

  test("a missing sign-in omits the bar", async () => {
    const dir = workspace();
    const allowance = await new GrokBotClient({
      supportDir: dir,
      cachePath: join(dir, "session.json"),
      fetch: (async () => {
        throw new Error("should not be called");
      }) as unknown as typeof fetch,
    }).allowance();
    expect(allowance).toEqual({ show: false, reason: "unavailable" });
  });
});
