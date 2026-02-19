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
bun run lazyusage claude --json       # single service snapshot
bun run lazyusage --json              # all services
bun run lazyusage-check claude --json # lightweight, no TUI
```

Returns:

```json
{
  "services": [{
    "name": "claude",
    "available": true,
    "metrics": [
      { "name": "session",     "remaining_pct": 74, "resets": "9:00pm" },
      { "name": "week_all",    "remaining_pct": 81, "resets": "Feb 25 at 11:00am" },
      { "name": "week_sonnet", "remaining_pct": 82, "resets": "Feb 25 at 11:00am" }
    ]
  }]
}
```

Act on `remaining_pct`. The `resets` field tells you when the window clears.

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
```

```bash
# One-liner: exit 1 if any metric below 20%
bun run lazyusage-check claude --json | jq -e \
  '.services[0].metrics | all(.remaining_pct >= 20)' > /dev/null
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
