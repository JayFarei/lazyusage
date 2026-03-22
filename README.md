# lazyusage

Usage monitoring for Claude CLI and Codex CLI.

`lazyusage` provides:

- a terminal dashboard
- single-shot text and JSON snapshots
- NDJSON streaming for agents
- a local HTTP/SSE server for dashboards or multi-agent coordination
- per-project ledger views backed by local session history

## Install

### Fastest path

```bash
bunx @lazyusage/cli --help
```

### Global install

```bash
bun add -g @lazyusage/cli
lazyusage --help
```

### From source

```bash
git clone https://github.com/jayfarei/lazyusage.git
cd lazyusage
bun install
bun run build
bun run lazyusage --help
```

## Requirements

- Bun `>= 1.3`
- Claude CLI (`claude`) and/or Codex CLI (`codex`) in `PATH`
- `tmux` is optional and used for PTY fallback and some end-to-end tests

## Quick start

```bash
# Interactive dashboard
lazyusage

# One-shot JSON for agents/scripts
lazyusage --json

# Most compact burn-rate check
lazyusage --capacity

# Lightweight point-in-time check
lazyusage usage-check --json
```

### Service selection

```bash
lazyusage claude
lazyusage codex
lazyusage all
```

### Text output

```bash
lazyusage --text
lazyusage claude --text
```

### JSON and NDJSON

```bash
lazyusage --json
lazyusage --json --live
lazyusage claude --json
lazyusage --json-only
```

### Capacity-only output

```bash
lazyusage --capacity
lazyusage --capacity --json
lazyusage --capacity --json --live
```

### Local server

The server is designed for local tooling. It binds to `127.0.0.1` by default and is intended for localhost browser or agent consumers.

```bash
lazyusage --serve
lazyusage --serve --port 3000
lazyusage --serve --host 0.0.0.0 --port 3000
```

Endpoints:

- `GET /` all configured services
- `GET /claude` Claude only
- `GET /codex` Codex only
- `GET /health` server metadata
- `GET /stream` SSE stream for all configured services
- `GET /stream/claude` SSE stream for Claude only
- `GET /stream/codex` SSE stream for Codex only

## Agent integration

The canonical agent skill lives at [`skills/lazyusage/SKILL.md`](skills/lazyusage/SKILL.md).

It covers:

- pre-flight capacity checks
- adaptive throttling
- stale/fallback-aware decision making
- sleep-until-reset logic
- service failover
- shared local server usage for multiple agents

Runnable examples:

- [`examples/agent_integration.ts`](examples/agent_integration.ts)
- [`examples/agent_integration.sh`](examples/agent_integration.sh)
- [`examples/dashboard/README.md`](examples/dashboard/README.md)

## JSON contract

Snapshot responses include resource-awareness metadata so agents can distinguish fresh data from fallback or cached data.

Example:

```json
{
  "timestamp": "2026-03-22T12:00:00.000Z",
  "available_services": ["claude", "codex"],
  "services": [
    {
      "name": "claude",
      "available": true,
      "source": "api",
      "stale": false,
      "error": null,
      "subscription_type": "Max",
      "metrics": [
        {
          "name": "session",
          "used_pct": 26,
          "remaining_pct": 74,
          "time_elapsed_pct": 61,
          "capacity_remaining": 35,
          "resets": "9:00pm"
        }
      ]
    }
  ]
}
```

Important fields:

- `source`: where the snapshot came from (`api`, `pty`, `cache`, `fallback`)
- `stale`: whether the last good result is being reused
- `error`: fetch failure detail when the service could not return a fresh clean result
- `remaining_pct`: hard limit headroom
- `capacity_remaining`: burn-rate headroom relative to elapsed time

Treat `remaining_pct` as the hard gate. Treat `source`, `stale`, and `error` as confidence signals.

## Styling

The TUI ships with an intentional default theme instead of pretending to be fully themeable. An alternate monochrome palette is available for minimal terminals:

```bash
LAZYUSAGE_THEME=monochrome lazyusage
```

## Package layout

- [`packages/core`](packages/core) publishable library package
- [`packages/cli`](packages/cli) publishable CLI package
- [`skills/lazyusage`](skills/lazyusage) canonical agent skill
- [`examples/dashboard`](examples/dashboard) browser dashboard example

## Development

```bash
bun install
bun run build
bun run test:core
bun run test:cli
bun run test:tui
bun run test:smoke
```

Useful local commands:

```bash
bun run lazyusage
bun run lazyusage --json
bun run lazyusage-check --json
bun run lazyusage:dev --json
```
