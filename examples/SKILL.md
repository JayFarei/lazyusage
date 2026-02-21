---
name: lazyusage
description: >
  Agent capacity management for Claude CLI and Codex CLI rate limits.
  Provides real-time usage monitoring via JSON, NDJSON streams, and HTTP server.
  Use when an agent needs to: check remaining capacity before expensive work,
  throttle volume when approaching limits, sleep through a rate-limit reset window,
  failover between Claude and Codex, monitor capacity continuously, or coordinate
  capacity across multiple agents. Triggers on: "check capacity", "am I rate limited",
  "how much quota do I have left", "usage check", "remaining tokens", or any
  situation where an agent is about to spawn sub-agents or do batch work.
---

# Agent Capacity Management

Check rate-limit capacity and take intelligent action to avoid hitting limits.

## Fetching capacity

```bash
# Most compact: capacity delta only, ideal for a quick agent check
bun run lazyusage claude --capacity        # single service, text
bun run lazyusage --capacity               # all services, text
bun run lazyusage claude --capacity --json # single service, JSON
bun run lazyusage --capacity --json        # all services, JSON
bun run lazyusage --capacity --json --live # continuous NDJSON stream

# Full text: all fields in one line per service
bun run lazyusage claude --text
bun run lazyusage --text

# Full structured data: all fields, machine-readable
bun run lazyusage claude --json
bun run lazyusage --json
bun run lazyusage-check claude --json      # lightweight, no TUI
```

**Use `--capacity`** for the most token-efficient check - returns only the headroom delta, nothing else.
**Use `--text`** when you need full context (allowance used, time elapsed, reset time) but still want a single readable line.
**Use `--json`** when you need to act on specific fields programmatically.

`--capacity` text example:
```
Claude: Session: +25% | Weekly: +18% | Sonnet: +22% [Subscription: Max]
Codex: 5h: 0% | Weekly: +47% [Subscription: Plus]
```

`--capacity --json` returns:
```json
{
  "services": [{
    "name": "claude",
    "available": true,
    "metrics": [
      { "name": "session",     "capacity_remaining": 25 },
      { "name": "week_all",    "capacity_remaining": 18 },
      { "name": "week_sonnet", "capacity_remaining": 22 }
    ]
  }]
}
```

`--text` example output:
```
Session: 17% allowance used, 42% time elapsed, 25% capacity remaining (resets 4:00pm) | Weekly: 25% allowance used, 60% time elapsed, 35% capacity remaining (resets Feb 25 at 10:00am) | Sonnet: 22% allowance used, 60% time elapsed, 38% capacity remaining (resets Feb 25 at 10:00am) [Subscription: Max]
```

`--json` returns:

```json
{
  "services": [{
    "name": "claude",
    "available": true,
    "metrics": [
      { "name": "session",     "used_pct": 17, "remaining_pct": 83, "time_elapsed_pct": 42, "capacity_remaining": 25, "resets": "9:00pm" },
      { "name": "week_all",    "used_pct": 25, "remaining_pct": 75, "time_elapsed_pct": 60, "capacity_remaining": 35, "resets": "Feb 25 at 11:00am" },
      { "name": "week_sonnet", "used_pct": 22, "remaining_pct": 78, "time_elapsed_pct": 60, "capacity_remaining": 38, "resets": "Feb 25 at 11:00am" }
    ]
  }]
}
```

Key fields:
- `remaining_pct` - raw allowance left in this window (100 - used_pct)
- `time_elapsed_pct` - how far through the window you are (e.g., 42% of a 5h session has passed)
- `capacity_remaining` - `time_elapsed_pct - used_pct`; positive means ahead of pace, negative means burning faster than expected
- `resets` - when the window clears

Act on `remaining_pct` for hard limits. Use `capacity_remaining` to detect burn-rate trends.

| Service | Metric | Window |
|---------|--------|--------|
| Claude | `session` | Rolling ~5h |
| Claude | `week_all` | Weekly, all models |
| Claude | `week_sonnet` | Weekly, Sonnet only |
| Codex | `5h` | Rolling 5h |
| Codex | `weekly` | Weekly |

## Decision thresholds

| Remaining | Level | Action |
|-----------|-------|--------|
| >= 50% | Green | Full speed |
| 20-49% | Yellow | Reduce volume |
| < 20% | Red | Pause, failover, or sleep until reset |

## Scenario 1: Pre-flight capacity check

Before starting expensive work, verify you have room.

```typescript
import { $ } from "bun";

const snap = await $`bun run lazyusage claude --json`.json();
const metrics = snap.services[0]?.metrics ?? [];
const tightest = metrics.reduce((a, b) =>
  a.remaining_pct <= b.remaining_pct ? a : b
);

if (tightest.remaining_pct < 20) {
  // defer, reduce scope, or sleep
}

// Also check burn rate: if capacity_remaining < -20, you're consuming 20%+ faster than pace
const overPace = metrics.filter(m => m.capacity_remaining < -20);
if (overPace.length > 0) {
  // Consider throttling even if remaining_pct looks OK
}
```

```bash
# One-liner: exit 1 if any metric below 20%
bun run lazyusage-check claude --json | jq -e \
  '.services[0].metrics | all(.remaining_pct >= 20)' > /dev/null

# Most compact check - capacity delta only
bun run lazyusage claude --capacity

# Capacity JSON for programmatic burn-rate check
bun run lazyusage claude --capacity --json | jq -e \
  '.services[0].metrics | all(.capacity_remaining >= 0)' > /dev/null
```

## Scenario 2: Adaptive throttling

Scale agent behavior to match available capacity.

```typescript
const level = tightest.remaining_pct >= 50 ? "green"
            : tightest.remaining_pct >= 20 ? "yellow"
            : "red";

const config = {
  green:  { maxParallel: 10, contextTokens: 100_000, model: "opus" },
  yellow: { maxParallel: 3,  contextTokens: 30_000,  model: "sonnet" },
  red:    { maxParallel: 1,  contextTokens: 10_000,  model: "haiku" },
}[level];
```

Techniques for reducing volume at yellow:
- Summarize history instead of passing full conversation
- Fewer parallel agents (1-2 instead of 5-10)
- Ask for concise output
- Combine multiple small requests into fewer larger ones
- If `week_sonnet` is tighter than `week_all`, switch to Haiku for non-critical tasks

## Scenario 3: Sleep until reset

When capacity is red, sleep through the reset window. Add a 1-minute buffer; limits don't always clear instantly.

```typescript
function msUntilReset(resets: string): number {
  const now = new Date();
  // "9:00pm"
  const m = resets.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (m) {
    let h = parseInt(m[1]);
    if (m[3].toLowerCase() === "pm" && h !== 12) h += 12;
    if (m[3].toLowerCase() === "am" && h === 12) h = 0;
    const target = new Date(now);
    target.setHours(h, parseInt(m[2]), 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }
  // "Feb 25 at 11:00am"
  const l = resets.match(/^(\w+)\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})(am|pm)$/i);
  if (l) {
    const mo = new Date(`${l[1]} 1, 2000`).getMonth();
    let h = parseInt(l[3]);
    if (l[5].toLowerCase() === "pm" && h !== 12) h += 12;
    if (l[5].toLowerCase() === "am" && h === 12) h = 0;
    const target = new Date(now.getFullYear(), mo, parseInt(l[2]), h, parseInt(l[4]));
    if (target <= now) target.setFullYear(target.getFullYear() + 1);
    return target.getTime() - now.getTime();
  }
  return 3_600_000; // fallback: 1h
}

const waitMs = msUntilReset(tightest.resets) + 60_000;
await new Promise(r => setTimeout(r, waitMs));
// re-check capacity after waking
```

## Scenario 4: Service failover

If Claude is at capacity, Codex might still have room (and vice versa).

```typescript
const snap = await $`bun run lazyusage --json`.json();
const ranked = snap.services
  .filter(s => s.available)
  .map(s => ({
    name: s.name,
    headroom: Math.min(...s.metrics.map(m => m.remaining_pct)),
  }))
  .sort((a, b) => b.headroom - a.headroom);

const best = ranked[0]; // use best.name for your API calls
```

## Scenario 5: Continuous monitoring

For long-running loops, subscribe to the NDJSON stream instead of polling.

```bash
bun run lazyusage --json --live   # one JSON line per ~10s refresh
```

```typescript
const proc = Bun.spawn(["bun", "run", "usage", "--json", "--live"], { stdout: "pipe" });
const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
let buf = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const snap = JSON.parse(line);
    // react to capacity changes in real time
  }
}
```

## Scenario 6: Multi-agent shared server

Start the server once, let all agents query it. Avoids redundant API calls.

```bash
# Terminal 1: start server
bun run lazyusage --serve --port 3000

# Any agent:
curl -s http://localhost:3000/usage | jq '.services[0].metrics'

# Real-time SSE stream:
curl -N http://localhost:3000/usage/stream
```

## Decision flowchart

```
Check capacity
  |
  +-> >= 50%  [GREEN]  Full speed
  |
  +-> >= 20%  [YELLOW] Throttle: smaller batches, fewer agents, cheaper models
  |
  +-> < 20%   [RED]
        |
        +-> Alt service has capacity? -> Failover
        |
        +-> No alternative -> Sleep until reset + 1 min buffer
                                 |
                                 +-> Re-check (max 3 retries)
```
