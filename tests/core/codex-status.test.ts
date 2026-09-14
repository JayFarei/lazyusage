/**
 * Tests for the Codex CLI /status output parser (PTY fallback source).
 */
import { describe, expect, test } from "bun:test";
import { accountLimitSection, parseCodexOutput, parseSubscription } from "../../packages/core/src/parsers/codex.js";
import type { MetricData } from "../../packages/core/src/types.js";
import { formatResetDate } from "../../packages/core/src/utils/time.js";

const year = new Date().getFullYear();

/** Codex CLI 0.154 status box: weekly-only account limit followed by a per-model Spark section. */
const WEEKLY_ONLY_STATUS = [
  "╭─────────────────────────────────────────────────────────────────────────────────────────╮",
  "│  >_ OpenAI Codex (v0.154.0)                                                             │",
  "│                                                                                         │",
  "│  Model:                       gpt-6-astra (reasoning medium, summaries auto)            │",
  "│  Account:                     user@example.com (Pro Lite)                               │",
  "│  Session:                     01a0a035-0de2-7a22-9731-70e80f49bdab                      │",
  "│                                                                                         │",
  "│  Weekly limit:                [██████████████░░░░░░] 72% left (resets 10:32 on 19 Sep)  │",
  "│  GPT-5.3-Codex-Spark limit:                                                             │",
  "│  5h limit:                    [████████████████████] 100% left (resets 19:57)           │",
  "│  Weekly limit:                [████████████████████] 100% left (resets 14:57 on 21 Sep) │",
  "╰─────────────────────────────────────────────────────────────────────────────────────────╯",
].join("\n");

/** Older status box: 5h and weekly account limits, weekly reset on the following line. */
const LEGACY_STATUS = [
  "│  Account:        user@example.com (pro)",
  "│  5h limit:       [████████░░░░░░░░░░░░] 80% left (resets 14:05)",
  "│  Weekly limit:   [██████████████████░░] 90% left",
  "│                  (resets 10:00 on 20 Feb)",
].join("\n");

describe("accountLimitSection", () => {
  test("cuts at the first per-model limit header", () => {
    const section = accountLimitSection(WEEKLY_ONLY_STATUS);
    expect(section).toContain("72% left");
    expect(section).not.toContain("Spark");
    expect(section).not.toContain("5h limit");
  });

  test("returns the whole output when there is no per-model section", () => {
    expect(accountLimitSection(LEGACY_STATUS)).toBe(LEGACY_STATUS);
  });
});

describe("parseCodexOutput - weekly-only status (2026)", () => {
  const metrics = parseCodexOutput(WEEKLY_ONLY_STATUS);

  test("does not emit a 5h metric from the per-model section", () => {
    expect(metrics["5h"]).toBeUndefined();
  });

  test("parses the account-wide weekly limit with same-line reset", () => {
    const weekly = metrics.weekly as MetricData;
    expect(weekly.used_pct).toBe(28);
    expect(weekly.remaining_pct).toBe(72);
    expect(weekly.resets).toBe(formatResetDate(new Date(year, 8, 19, 10, 32)));
  });

  test("parses a multi-word plan name", () => {
    expect(metrics.subscription_type).toBe("Pro Lite");
  });
});

describe("parseCodexOutput - legacy status with 5h and weekly", () => {
  const metrics = parseCodexOutput(LEGACY_STATUS);

  test("parses the 5h limit", () => {
    const fiveH = metrics["5h"] as MetricData;
    expect(fiveH.used_pct).toBe(20);
    expect(fiveH.remaining_pct).toBe(80);
    expect(fiveH.resets).toBe("2:05pm");
  });

  test("parses the weekly limit with next-line reset", () => {
    const weekly = metrics.weekly as MetricData;
    expect(weekly.used_pct).toBe(10);
    expect(weekly.resets).toBe(formatResetDate(new Date(year, 1, 20, 10, 0)));
  });

  test("title-cases a single-word plan name", () => {
    expect(metrics.subscription_type).toBe("Pro");
  });
});

describe("parseCodexOutput - unparseable output", () => {
  test("yields weekly zeros with a fallback reset and no 5h", () => {
    const metrics = parseCodexOutput("");
    expect(metrics["5h"]).toBeUndefined();
    const weekly = metrics.weekly as MetricData;
    expect(weekly.used_pct).toBe(0);
    expect(weekly.remaining_pct).toBe(100);
    expect(weekly.resets).toContain(" at ");
    expect(metrics.subscription_type).toBeNull();
  });
});

describe("parseSubscription", () => {
  test("returns null when no account line is present", () => {
    expect(parseSubscription("Weekly limit: 50% left")).toBeNull();
  });
});
