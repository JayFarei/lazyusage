---
name: lazyusage
description: >
  Resource-aware usage monitoring for Claude CLI and Codex CLI.
  Use when an agent needs to check quota before expensive work, throttle near
  limits, react to stale or fallback data, fail over between services, or share
  a local usage server with other agents.
---

# lazyusage

Use `lazyusage` before starting expensive work or spawning many parallel agents.

## Core commands

```bash
# Fast human-readable checks
lazyusage --capacity
lazyusage claude --capacity
lazyusage --text

# Machine-readable snapshots
lazyusage --json
lazyusage claude --json
lazyusage usage-check --json

# Continuous monitoring
lazyusage --json --live
lazyusage --capacity --json --live

# Shared local server
lazyusage --serve --port 3000
```

## Resource awareness

Do not look only at `remaining_pct`.

Inspect these fields per service:

- `source`: `api`, `pty`, `cache`, or `fallback`
- `stale`: `true` means the tool is reusing older good data
- `error`: non-null means a fresh clean fetch did not succeed

Recommended policy:

- `source=api` and `stale=false`: treat as fresh
- `source=pty`: usable, but slower and more fragile
- `source=cache` or `stale=true`: reduce confidence and avoid large fan-out
- `source=fallback` or non-null `error`: do not assume headroom is truly healthy

## Thresholds

- `remaining_pct >= 50`: green, full speed
- `remaining_pct 20-49`: yellow, reduce batch size and parallelism
- `remaining_pct < 20`: red, pause, fail over, or sleep until reset
- `capacity_remaining < 0`: burning faster than pace even if raw remaining looks acceptable

## Common patterns

### Prompt templates

- [`templates/claude-session-guard.prompt.md`](templates/claude-session-guard.prompt.md): prompt for Claude agents that should watch the Claude `session` / `Session (5h)` metric and sleep at 90-95% usage.

### Pre-flight gate

```bash
lazyusage usage-check --json | jq '.services[] | {name, source, stale, error, tightest: (.metrics | min_by(.remaining_pct))}'
```

Abort or reduce scope when:

- any service has `source="fallback"`
- `stale=true` for the service you plan to use
- the tightest metric has `remaining_pct < 20`

### Fail over between providers

Prefer the available service with:

1. non-stale `api` data
2. the highest minimum `remaining_pct`
3. the highest `capacity_remaining` when raw headroom is similar

### Shared local server

Start one server and let multiple agents read from it:

```bash
lazyusage --serve --port 3000
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/ | jq '.services[] | {name, source, stale}'
```

The server is local-first and binds to `127.0.0.1` by default.
