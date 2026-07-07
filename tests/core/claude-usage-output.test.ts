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
