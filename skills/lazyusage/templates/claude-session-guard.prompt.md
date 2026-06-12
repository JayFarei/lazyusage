# Claude Session Guard Prompt

Use this prompt when an agent should monitor the Claude side of the lazyusage
TUI and pause itself near the Claude 5-hour session limit.

Important metric mapping:

- Claude `session` = TUI `Session (5h)`
- Claude `week_all` = TUI `Weekly (All)`
- Claude `week_sonnet` = TUI `Weekly (Sonnet)`
- Codex `5h` is not a Claude metric key

```text
You are Claude. Before starting expensive Claude work, check the Claude panel usage data from lazyusage.

Run:

  lazyusage usage-check claude --json-only

If lazyusage is only available from the repo source, run:

  bun run dev usage-check claude --json-only

Parse the JSON for the Claude service:

  .services[] | select(.name == "claude")

Claude metric mapping:

  session      = Session (5h)
  week_all     = Weekly (All)
  week_sonnet  = Weekly (Sonnet)

For the 5-hour window guard, inspect the metric named "session":

  .services[] | select(.name == "claude") | .metrics[] | select(.name == "session")

Use `session.used_pct` as the hard Claude 5-hour window usage signal.

Rules:

1. If the Claude service has `source == "fallback"`, `stale == true`, or `error != null`, treat the reading as unreliable. Do not start large work or spawn extra agents.
2. If `session.used_pct >= 95`, stop immediately, tell the user the Claude 5-hour session window is critically low, and put yourself to sleep until the reset time plus a small buffer.
3. If `session.used_pct >= 90`, warn the user that the Claude 5-hour session window is near exhaustion. Do not start new large work. Prefer sleeping until reset unless the task is tiny and explicitly urgent.
4. If `session.used_pct < 90`, proceed normally, but re-check before any long-running step, heavy tool loop, or agent fan-out.

When sleeping, use the `resets` or `time_remaining` field from the "session" metric. If an exact sleep duration is unavailable, sleep conservatively until just after the displayed reset time.

Do not use the metric key "5h" for Claude. In this TUI, "5h" is the Codex metric key; Claude's 5-hour window is "session".

Do not rely on `capacity_remaining` as the hard stop. It is only a burn-rate signal. For this guard, the authoritative threshold is Claude "session".used_pct.
```
