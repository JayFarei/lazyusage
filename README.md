# lazyusage

Usage monitoring for Claude CLI and Codex CLI.

`lazyusage` is built around two ideas:

1. **A tmux-popup-ready control center for your subscriptions.** Bind the TUI to a tmux key and get instant, glanceable control over session, weekly, and model-specific limits without leaving your editor or agent session.
2. **A capacity API for agents.** Agents running on a goal, workflow, or loop can ask `lazyusage` how much capacity is left before starting expensive work, and capacity-management strategies (for example, dedicating only a slice of remaining capacity to unsupervised work) can be layered on top of its JSON output.

It provides:

- a terminal dashboard (OpenTUI/SolidJS)
- single-shot text and JSON snapshots
- NDJSON streaming for agents
- a local HTTP/SSE server for dashboards or multi-agent coordination
- per-project ledger views backed by local session history
- an optional background collector daemon with usage history and predictions

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

### tmux popup

The TUI is designed to live in a tmux popup, a one-keystroke overlay on top of whatever you are doing:

```bash
# ~/.tmux.conf: open lazyusage in a popup with prefix + u
bind-key u display-popup -E -w 90% -h 80% "lazyusage"
```

Press `prefix + u` to check your limits, press `q` (or `Esc`) to dismiss. Useful variants:

```bash
# Claude only, smaller popup
bind-key U display-popup -E -w 70% -h 50% "lazyusage claude"
```

This pairs well with long-running agent sessions: keep agents working in your panes, pop the dashboard over them when you want to see how much subscription headroom they have left.

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

## Collector daemon

For continuous history (and the TUI's Graph tab), run the always-on collector daemon. It samples usage on an interval and stores snapshots in the local SQLite database, so history accumulates even when the TUI is closed.

```bash
lazyusage daemon start      # start in the background
lazyusage daemon status     # health, last collection, data freshness
lazyusage daemon logs       # recent log output
lazyusage daemon stop       # stop the daemon

# Run at login as a background service
lazyusage daemon install    # launchd agent on macOS, systemd user unit on Linux
lazyusage daemon uninstall
```

Configuration is optional and lives at `~/.config/lazyusage/daemon.toml`. When the daemon is healthy, the TUI hydrates from its stored snapshots instead of starting its own collection chain, and the stats panel gains a Graph tab (cycle with `Tab`: Daily, Weekly, Monthly, Graph).

## Capacity prediction and planning

`lazyusage` can project how much spare capacity you will have at the end of the current weekly window, based on your recorded usage history:

```bash
# Show predicted spare capacity at window end
lazyusage --predict

# Mark upcoming days with an expected work intensity (regime) to refine the prediction
lazyusage plan 2026-06-15 H        # High, ~15%/day
lazyusage plan 2026-06-16 L        # Low, ~3%/day
lazyusage plan list
lazyusage plan clear 2026-06-15
lazyusage plan clear --all
```

Regimes: `L` (Low, 3%/day), `M` (Medium, 9%/day), `H` (High, 15%/day), `B` (Burst, 25%/day).

This is the foundation for capacity-management strategies: if the prediction says you will end the week with 30% spare, you can decide to dedicate that slice to unsupervised agent work and keep the rest for interactive sessions.

## Agent integration

The canonical agent skill lives at [`skills/lazyusage/SKILL.md`](skills/lazyusage/SKILL.md).

It covers:

- pre-flight capacity checks
- adaptive throttling
- stale/fallback-aware decision making
- sleep-until-reset logic
- service failover
- shared local server usage for multiple agents

### Capacity budgets for unsupervised work

A simple, robust pattern for agents on a goal/loop: give background work only a fixed share of the remaining capacity and stop when it is spent.

```bash
# Gate a work loop on a capacity budget:
# unsupervised work may use at most 40% of what currently remains.
START=$(lazyusage usage-check claude --json-only | jq '[.services[] | select(.name=="claude").metrics[] | select(.name=="week_all").remaining_pct] | first')
BUDGET=$(echo "$START * 0.4" | bc)

while true; do
  NOW=$(lazyusage usage-check claude --json-only | jq '[.services[] | select(.name=="claude").metrics[] | select(.name=="week_all").remaining_pct] | first')
  SPENT=$(echo "$START - $NOW" | bc)
  if [ "$(echo "$SPENT >= $BUDGET" | bc)" -eq 1 ]; then
    echo "capacity budget exhausted, stopping unsupervised work"
    break
  fi
  run_one_unit_of_work
done
```

The same logic works against the HTTP server (`GET /claude`) when several agents share one collector, and `--predict` can replace the static 40% with a dynamic budget derived from predicted end-of-window spare capacity.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

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
