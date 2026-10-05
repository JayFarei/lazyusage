import { describe, expect, test } from "bun:test";
import { detectAvailableServices, validateService } from "../../packages/cli/src/commands/usage-check.js";

describe("detectAvailableServices", () => {
  test("returns an array", () => {
    const result = detectAvailableServices();
    expect(Array.isArray(result)).toBe(true);
  });

  test("only contains valid service names", () => {
    const result = detectAvailableServices();
    for (const svc of result) {
      expect(["claude", "codex", "grok"]).toContain(svc);
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

  test("returns grok when requested", () => {
    expect(validateService("grok", ["claude", "grok"])).toEqual(["grok"]);
  });

  test("'all' returns every installed service, including grok", () => {
    expect(validateService("all", ["claude", "codex", "grok"])).toEqual(["claude", "codex", "grok"]);
  });
});
