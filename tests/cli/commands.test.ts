import { describe, test, expect } from "bun:test";
import { detectAvailableServices, validateService } from "../../packages/cli/src/commands/usage-check.js";

describe("detectAvailableServices", () => {
  test("returns an array", () => {
    const result = detectAvailableServices();
    expect(Array.isArray(result)).toBe(true);
  });

  test("only contains valid service names", () => {
    const result = detectAvailableServices();
    for (const svc of result) {
      expect(["claude", "codex"]).toContain(svc);
    }
  });
});

describe("validateService", () => {
  test("auto-detects when no service specified", () => {
    const result = validateService(undefined, ["claude", "codex"]);
    expect(result).toEqual(["claude", "codex"]);
  });

  test("auto-detects single available service", () => {
    const result = validateService(undefined, ["claude"]);
    expect(result).toEqual(["claude"]);
  });

  test("returns both for 'all'", () => {
    const result = validateService("all", ["claude", "codex"]);
    expect(result).toEqual(["claude", "codex"]);
  });

  test("returns specific service when requested", () => {
    const result = validateService("claude", ["claude", "codex"]);
    expect(result).toEqual(["claude"]);
  });

  test("returns codex when requested", () => {
    const result = validateService("codex", ["claude", "codex"]);
    expect(result).toEqual(["codex"]);
  });
});
