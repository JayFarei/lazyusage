/**
 * Integration tests for the HTTP/SSE server.
 * Tests the HTTP layer directly. Without real credentials, the chain
 * returns fallback data, which is sufficient to test routing and response shape.
 */
import { describe, test, expect, afterEach } from "bun:test";
import { startServer } from "../../packages/cli/src/server/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  if (server) {
    server.stop(true);
    server = null;
  }
});

function createTestServer(services = ["claude", "codex"]): ReturnType<typeof Bun.serve> {
  server = startServer({
    services,
    port: 0, // random available port
    host: "127.0.0.1",
    refreshInterval: 60,
    debug: false,
  });
  return server;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Server - /health endpoint", () => {
  test("returns 200 with expected shape", async () => {
    const srv = createTestServer();
    const resp = await fetch(`http://127.0.0.1:${srv.port}/health`);
    expect(resp.status).toBe(200);

    const body = await resp.json();
    expect(body.status).toBe("ok");
    expect(body.services).toEqual(["claude", "codex"]);
    expect(body.refresh_interval).toBe(60);
  });
});

describe("Server - / root endpoint", () => {
  test("returns JSON with services data", async () => {
    const srv = createTestServer();
    const resp = await fetch(`http://127.0.0.1:${srv.port}/`);
    expect(resp.status).toBe(200);

    const body = await resp.json();
    expect(typeof body).toBe("object");
    // formatCombinedJson returns a JSON string with services array
    expect(body.services).toBeDefined();
  }, 15_000);
});

describe("Server - /claude endpoint", () => {
  test("returns JSON for claude service", async () => {
    const srv = createTestServer(["claude", "codex"]);
    const resp = await fetch(`http://127.0.0.1:${srv.port}/claude`);
    expect(resp.status).toBe(200);

    const body = await resp.json();
    expect(typeof body).toBe("object");
  }, 15_000);
});

describe("Server - 404 for unknown paths", () => {
  test("returns 404 for /nonexistent", async () => {
    const srv = createTestServer();
    const resp = await fetch(`http://127.0.0.1:${srv.port}/nonexistent`);
    expect(resp.status).toBe(404);

    const body = await resp.json();
    expect(body.error).toBe("Not Found");
  });
});

describe("Server - CORS preflight", () => {
  test("returns 200 for OPTIONS request", async () => {
    const srv = createTestServer();
    const resp = await fetch(`http://127.0.0.1:${srv.port}/health`, {
      method: "OPTIONS",
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("Server - SSE /stream", () => {
  test("sends connected comment and initial data event", async () => {
    const srv = createTestServer();
    const controller = new AbortController();

    try {
      const resp = await fetch(`http://127.0.0.1:${srv.port}/stream`, {
        signal: controller.signal,
      });
      expect(resp.status).toBe(200);
      expect(resp.headers.get("Content-Type")).toBe("text/event-stream");

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      // Read chunks until we have the connected comment and a data event
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        // Check for both the `: connected` comment and at least one `data:` event
        if (accumulated.includes(": connected") && accumulated.includes("data:")) {
          break;
        }
      }

      expect(accumulated).toContain(": connected");
      expect(accumulated).toContain("data:");
    } finally {
      controller.abort();
    }
  }, 20_000);
});
