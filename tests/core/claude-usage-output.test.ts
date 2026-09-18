import { describe, expect, test } from "bun:test";
import { parseClaudeOutput } from "lazyusage-core";

describe("parseClaudeOutput", () => {
  test("parses current Fable weekly usage output", () => {
    const output = `
Weekly limits

Current session
Resets 2:20pm (Europe/London)
8% used

Current week (all models)
Resets Jul 9 at 10pm (Europe/London)
77% used

Current week (Fable)
Resets Jul 9 at 10pm (Europe/London)
85% used
`;

    const metrics = parseClaudeOutput(output);

    expect(metrics.__parsed).toBe(true);
    expect((metrics.session as { used_pct: number }).used_pct).toBe(8);
    expect((metrics.week_all as { used_pct: number }).used_pct).toBe(77);
    expect((metrics.week_sonnet as { used_pct: number }).used_pct).toBe(85);
    expect((metrics.week_sonnet as { resets: string }).resets).toBe("Jul 9 at 10pm");
  });

  test("keeps parsing legacy Sonnet weekly usage output", () => {
    const output = `
Current week (Sonnet only)
Resets Feb 9 at 8:19pm (Europe/London)
10% used
`;

    const metrics = parseClaudeOutput(output);

    expect(metrics.__parsed).toBe(true);
    expect((metrics.week_sonnet as { used_pct: number }).used_pct).toBe(10);
    expect((metrics.week_sonnet as { resets: string }).resets).toBe("Feb 9 at 8:19pm");
  });
});

describe("parseClaudeOutput - Claude Code 2.1.27x /usage screen", () => {
  test("parses the bars below the tab bar, session summary and plugin footprint sections", () => {
    const output = `
   Settings  Status   Config   Usage   Stats
   Session
   Total cost:            $0.0000
   Total duration (API):  0s
   Total duration (wall): 8s
   Total code changes:    0 lines added, 0 lines removed
   Usage:                 0 input, 0 output, 0 cache read, 0 cache write
   Plugin skill-listing footprint
   What each plugin's skill descriptions add to the system prompt (cached input after the first turn). Agents and MCP tools not yet
   counted.
   vercel                      4 skills · ~225 tok/turn
   Total                       ~354 tok/turn
   Current session
   ██████████████                                     28% used
   Resets 1:20pm (Europe/London)
   Current week (all models)
   ███▌                                               7% used
   Resets Sep 24 at 10pm (Europe/London)
   Current week (Fable)
   ███▌                                               7% used
   Resets Sep 24 at 10pm (Europe/London)
`;

    const metrics = parseClaudeOutput(output);

    expect(metrics.__parsed).toBe(true);
    expect((metrics.session as { used_pct: number; resets: string }).used_pct).toBe(28);
    expect((metrics.session as { used_pct: number; resets: string }).resets).toBe("1:20pm");
    expect((metrics.week_all as { used_pct: number; resets: string }).used_pct).toBe(7);
    expect((metrics.week_all as { used_pct: number; resets: string }).resets).toBe("Sep 24 at 10pm");
    expect((metrics.week_sonnet as { used_pct: number }).used_pct).toBe(7);
  });
});
