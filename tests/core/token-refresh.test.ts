/**
 * Integration tests for ClaudeCredentialStore.tryRefreshToken() and _persistCredentials().
 * Uses a local Bun.serve() mock OAuth server and a temp credentials file.
 * No Keychain, no real OAuth calls.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, readFileSync, rmSync } from "fs";
import { ClaudeCredentialStore } from "../../packages/core/src/providers/credentials.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempCredsPath(): string {
  return join(tmpdir(), `test-creds-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function writeCredsFile(path: string, overrides: Record<string, unknown> = {}): void {
  const base = {
    claudeAiOauth: {
      accessToken: "sk-ant-oat01-EXPIRED",
      refreshToken: "sk-ant-ort01-TESTTOKEN",
      expiresAt: Date.now() - 60_000, // already expired
      subscriptionType: "max",
      rateLimitTier: "default",
      ...overrides,
    },
  };
  Bun.write(path, JSON.stringify(base));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClaudeCredentialStore - token refresh", () => {
  let tmpCredsPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpCredsPath = makeTempCredsPath();
    originalEnv = process.env.CLAUDE_CREDENTIALS_FILE;
  });

  afterEach(() => {
    // Restore env
    if (originalEnv === undefined) {
      delete process.env.CLAUDE_CREDENTIALS_FILE;
    } else {
      process.env.CLAUDE_CREDENTIALS_FILE = originalEnv;
    }
    // Remove temp file
    try { rmSync(tmpCredsPath); } catch { /* already gone */ }
  });

  test("isAvailable() returns false for expired token", () => {
    writeCredsFile(tmpCredsPath);
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    const store = new ClaudeCredentialStore();
    expect(store.isAvailable()).toBe(false);
  });

  test("canRefresh() returns true when sk-ant-ort01- refresh token present", () => {
    writeCredsFile(tmpCredsPath);
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    const store = new ClaudeCredentialStore();
    expect(store.canRefresh()).toBe(true);
  });

  test("canRefresh() returns false when no refresh token", () => {
    writeCredsFile(tmpCredsPath, { refreshToken: "" });
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    const store = new ClaudeCredentialStore();
    expect(store.canRefresh()).toBe(false);
  });

  test("canRefresh() returns false when refresh token has wrong prefix", () => {
    writeCredsFile(tmpCredsPath, { refreshToken: "sk-ant-oat01-NOTREFRESH" });
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    const store = new ClaudeCredentialStore();
    expect(store.canRefresh()).toBe(false);
  });

  test("tryRefreshToken() calls OAuth endpoint with correct payload", async () => {
    writeCredsFile(tmpCredsPath);
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    let receivedBody: Record<string, unknown> = {};

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.json() as Record<string, unknown>;
        return Response.json({
          access_token: "sk-ant-oat01-REFRESHED",
          refresh_token: "sk-ant-ort01-NEWTOKEN",
          expires_in: 28800,
        });
      },
    });

    try {
      const store = new ClaudeCredentialStore();
      const result = await store.tryRefreshToken(`http://localhost:${server.port}`);

      expect(result).toBe(true);
      expect(receivedBody.grant_type).toBe("refresh_token");
      expect(receivedBody.refresh_token).toBe("sk-ant-ort01-TESTTOKEN");
      expect(receivedBody.client_id).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
    } finally {
      server.stop();
    }
  });

  test("tryRefreshToken() updates in-memory credentials on success", async () => {
    writeCredsFile(tmpCredsPath);
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    const server = Bun.serve({
      port: 0,
      async fetch() {
        return Response.json({
          access_token: "sk-ant-oat01-REFRESHED",
          refresh_token: "sk-ant-ort01-NEWTOKEN",
          expires_in: 28800,
        });
      },
    });

    try {
      const store = new ClaudeCredentialStore();
      const refreshed = await store.tryRefreshToken(`http://localhost:${server.port}`);

      expect(refreshed).toBe(true);
      expect(store.isAvailable()).toBe(true);

      const creds = store.getCredentials();
      expect(creds?.accessToken).toBe("sk-ant-oat01-REFRESHED");
      expect(creds?.refreshToken).toBe("sk-ant-ort01-NEWTOKEN");
    } finally {
      server.stop();
    }
  });

  test("tryRefreshToken() persists new tokens to credentials file", async () => {
    writeCredsFile(tmpCredsPath);
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    const server = Bun.serve({
      port: 0,
      async fetch() {
        return Response.json({
          access_token: "sk-ant-oat01-REFRESHED",
          refresh_token: "sk-ant-ort01-NEWTOKEN",
          expires_in: 28800,
        });
      },
    });

    try {
      const store = new ClaudeCredentialStore();
      await store.tryRefreshToken(`http://localhost:${server.port}`);

      // Wait briefly for async persist
      await Bun.sleep(100);

      expect(existsSync(tmpCredsPath)).toBe(true);
      const saved = JSON.parse(readFileSync(tmpCredsPath, "utf-8"));
      expect(saved.claudeAiOauth.accessToken).toBe("sk-ant-oat01-REFRESHED");
      expect(saved.claudeAiOauth.refreshToken).toBe("sk-ant-ort01-NEWTOKEN");
    } finally {
      server.stop();
    }
  });

  test("tryRefreshToken() returns false on HTTP error response", async () => {
    writeCredsFile(tmpCredsPath);
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    const server = Bun.serve({
      port: 0,
      async fetch() {
        return new Response("Unauthorized", { status: 401 });
      },
    });

    try {
      const store = new ClaudeCredentialStore();
      const result = await store.tryRefreshToken(`http://localhost:${server.port}`);

      expect(result).toBe(false);
      // In-memory creds unchanged (still expired)
      expect(store.isAvailable()).toBe(false);
    } finally {
      server.stop();
    }
  });

  test("tryRefreshToken() returns false when no refresh token", async () => {
    writeCredsFile(tmpCredsPath, { refreshToken: "" });
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    let serverCalled = false;
    const server = Bun.serve({
      port: 0,
      async fetch() {
        serverCalled = true;
        return Response.json({ access_token: "x", refresh_token: "y", expires_in: 28800 });
      },
    });

    try {
      const store = new ClaudeCredentialStore();
      const result = await store.tryRefreshToken(`http://localhost:${server.port}`);

      expect(result).toBe(false);
      expect(serverCalled).toBe(false);
    } finally {
      server.stop();
    }
  });

  test("concurrent tryRefreshToken() calls only hit the server once", async () => {
    writeCredsFile(tmpCredsPath);
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    let serverCallCount = 0;

    const server = Bun.serve({
      port: 0,
      async fetch() {
        serverCallCount++;
        // Small delay to ensure the second call arrives while first is in-flight
        await Bun.sleep(50);
        return Response.json({
          access_token: "sk-ant-oat01-REFRESHED",
          refresh_token: "sk-ant-ort01-NEWTOKEN",
          expires_in: 28800,
        });
      },
    });

    try {
      const store = new ClaudeCredentialStore();
      const [r1, r2] = await Promise.all([
        store.tryRefreshToken(`http://localhost:${server.port}`),
        store.tryRefreshToken(`http://localhost:${server.port}`),
      ]);

      // One should succeed, one should be rejected by the in-progress guard
      expect(r1 || r2).toBe(true); // at least one succeeded
      expect(serverCallCount).toBe(1); // server was hit exactly once
    } finally {
      server.stop();
    }
  });

  test("CLAUDE_CREDENTIALS_FILE env override is used for credential read", () => {
    writeCredsFile(tmpCredsPath, {
      accessToken: "sk-ant-oat01-VALID",
      expiresAt: Date.now() + 3_600_000,
    });
    process.env.CLAUDE_CREDENTIALS_FILE = tmpCredsPath;

    const store = new ClaudeCredentialStore();
    const creds = store.getCredentials();

    expect(creds?.accessToken).toBe("sk-ant-oat01-VALID");
  });
});
