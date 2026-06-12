# lazyusage

```text
█░░ ▄▀█ ▀█ █▄█ █░█ █▀ ▄▀█ █▀▀ █▀▀
█▄▄ █▀█ █▄ ░█░ █▄█ ▄█ █▀█ █▄█ ██▄
```

[![CI](https://github.com/jayfarei/lazyusage/actions/workflows/ci.yml/badge.svg)](https://github.com/jayfarei/lazyusage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-bun%20%E2%89%A51.3-black)](https://bun.sh)

Usage monitoring for Claude CLI and Codex CLI. A tmux-popup-ready control center for your subscriptions, and a capacity API for agents.

```text
╭─ [1] Claude CLI - max ───────────────╮╭─ [3] ━ Daily ━   Weekly     Monthly   ───────────────────╮
│ ▸ Weekly (All)                       ││                                                         ▲│
│   ▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ 11%       ││  Today                                                  █│
│      ┃  ┃  ┃  ┃  ┃  ┃                ││                                                         █│
│   ▓▓░░░░░░░░░░░░░░░░░░░░░░ ⏱ 7%      ││  Project        Input    Output  Cache%  Total ▼ %      █│
│                                      ││  ───────────────────────────────────────────────────────█│
│   Resets: Jun 18 at 10:00pm (6d 11h) ││  my-web-app     283,148  791,804 98.8%   86.7M   52.6%  █│
│   ⚡ OVER BUDGET -25%                ││  lazyusage      67,138   230,663 99.1%   32.4M   19.7%  █│
│                                      ││  api-server     208,467  254,679 98.3%   27.5M   16.7%  ▀│
│   Weekly (Sonnet) ◆ 1% ⏱ 7%          ││  infra-scripts  820      28,363  99.7%   9.5M    5.8%    │
│   Session (5h) ◆ 50% ⏱ 45%           ││  notes          14,561   25,786  99.2%   4.9M    3.0%    │
│                                      ││  experiments    1,686    18,264  99.5%   3.7M    2.3%    │
│                                      ││  ───────────────────────────────────────────────────────▼│
╰──────────────────────────────────────╯╰──────────────────────────────────────────────────────────╯
╭─ [2] Codex CLI - pro ────────────────╮╭─ [4] ━ Daily ━   Weekly     Monthly   ───────────────────╮
│ ▸ Weekly                             ││                                                          │
│   ▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ 12%       ││  Today                                                   │
│      ┃  ┃  ┃  ┃  ┃  ┃                ││                                                          │
│   ▓▓▓▓░░░░░░░░░░░░░░░░░░░░ ⏱ 16%     ││  Project         Input   Output  Cache%   Total ▼ %      │
│                                      ││  ────────────────────────────────────────────────────────│
│   Resets: Jun 18 at 8:30am (5d 21h)  ││  my-web-app      2.9M    11,828  0.0%     2.9M    100.0% │
│   ⚡ OVER BUDGET -19%                ││  ────────────────────────────────────────────────────────│
│                                      ││  Total           2.9M    11,828  0.0%     2.9M           │
│   Session (5h) ◆ 5% ⏱ 24%            ││                                                          │
│                                      ││                                                          │
╰──────────────────────────────────────╯╰──────────────────────────────────────────────────────────╯
 10:34:38 AM | Last updated: 10:34:35 AM | Auto-refresh: ON (10s) | Source: Claude: API | Codex: API
 [1]Claude  [3]ClaudeStats  [2]Codex  [4]CodexStats  j/k=Navigate  Tab=Focus  g=Fullscreen  ?=Help
```

`lazyusage` is built around two ideas:

1. **A tmux-popup-ready control center for your subscriptions.** Bind the TUI to a tmux key and get instant, glanceable control over session, weekly, and model-specific limits without leaving your editor or agent session.
2. **A capacity API for agents.** Agents running on a goal, workflow, or loop can ask `lazyusage` how much capacity is left before starting expensive work, and capacity-management strategies (for example, dedicating only a slice of remaining capacity to unsupervised work) can be layered on top of its JSON output.

## Quick start

```bash
# Install
bun add -g @lazyusage/cli

# Interactive dashboard
lazyusage

# One-shot JSON for agents/scripts
lazyusage --json

# Most compact burn-rate check
lazyusage --capacity

# Lightweight point-in-time check
lazyusage usage-check --json
```

Requirements: Bun `>= 1.3`, plus the Claude CLI (`claude`) and/or Codex CLI (`codex`) in `PATH`. `tmux` is optional (PTY fallback and some end-to-end tests).

## How it works

Each service is fetched through a fallback chain: the first source that answers wins, and every snapshot is stored locally so history and predictions survive restarts.

```text
  ┌────────────────┐      ┌────────────────┐
  │   Claude API   │      │   Codex API    │           data sources
  │  (OAuth creds) │      │  (auth.json)   │
  └───────┬────────┘      └───────┬────────┘
          │                       │
          ▼                       ▼
  ┌─────────────────────────────────────────┐
  │            fallback chain               │   per service, in order:
  │                                         │
  │  API ─► token refresh ─► PTY (tmux)     │   fresh API data, refreshed
  │              ─► cache ─► fallback zeros │   creds, driving the real CLI,
  │                                         │   last good data, safe zeros
  └────────────────────┬────────────────────┘
                       │ snapshots
                       ▼
              ┌─────────────────┐
              │  SQLite store   │◄────── collector daemon (optional,
              └────────┬────────┘        always-on, samples on interval)
                       │
      ┌────────────────┼────────────────┬─────────────────┐
      ▼                ▼                ▼                 ▼
  ┌────────┐    ┌─────────────┐   ┌───────────┐   ┌──────────────┐
  │  TUI   │    │ --text/json │   │ HTTP/SSE  │   │  --predict   │
  │ (popup)│    │  (agents)   │   │  server   │   │  + planning  │
  └────────┘    └─────────────┘   └───────────┘   └──────────────┘
```

Every snapshot carries its provenance (`source`, `stale`, `error`), so consumers can tell fresh data from a cached or fallback answer.

### The capacity model

The key derived metric is `capacity_remaining`: how far ahead of (or behind) pace you are within the current window.

```text
  time elapsed     ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  45%
  allowance used   ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░  50%
                            └──────────  capacity_remaining = 45 - 50 = -5%
                                         (negative: burning faster than time passes)
```

A positive value means you can speed up; a negative value means at the current pace you will hit the limit before the window resets. The TUI surfaces this as `⚡ OVER BUDGET` warnings; agents read it from JSON.

## The TUI

- 2x2 grid: one row per service, usage bars on the left, per-project token ledger on the right
- `Tab` cycles stats tabs (Daily, Weekly, Monthly, and Graph when the daemon is running)
- `j/k` navigate metrics, `g` fullscreen, `p` pause refresh, `?` help, `q` quit
- `lazyusage claude` or `lazyusage codex` shows a single service

### tmux popup

The TUI is designed to live in a tmux popup, a one-keystroke overlay on top of whatever you are doing. To set it up:

1. Make sure `lazyusage` is on your `PATH` (`bun add -g @lazyusage/cli`), or use the full path to the binary in the binding below.

2. Add a binding to `~/.tmux.conf`:

   ```bash
   # Open lazyusage in a popup with prefix + u
   bind-key u display-popup -E -w 90% -h 80% "lazyusage"
   ```

3. Reload your tmux configuration:

   ```bash
   tmux source-file ~/.tmux.conf
   ```

4. Press `prefix + u` (default prefix is `Ctrl-b`) to open the dashboard, and `q` to dismiss it. `-E` closes the popup automatically when the TUI exits.

Useful variants:

```bash
# Claude only, smaller popup
bind-key U display-popup -E -w 70% -h 50% "lazyusage claude"

# Bind without the prefix (root table), e.g. Alt+u
bind-key -n M-u display-popup -E -w 90% -h 80% "lazyusage"

# Running from a source checkout instead of a global install
bind-key u display-popup -E -w 90% -h 80% "cd /path/to/lazyusage && bun run lazyusage"
```

This pairs well with long-running agent sessions: keep agents working in your panes, pop the dashboard over them when you want to see how much subscription headroom they have left.

## For agents

### Output modes

```bash
lazyusage --capacity            # most compact: capacity_remaining only
lazyusage --text                # one line per service, all fields
lazyusage --json                # structured snapshot
lazyusage --json --live         # continuous NDJSON stream
lazyusage --json-only           # machine-safe: errors as JSON on stdout
lazyusage claude --json         # single service
lazyusage usage-check --json    # fast point-in-time check
```

What the text modes look like:

```text
$ lazyusage --capacity
Claude: Session: -5% | Weekly: -4% | Sonnet: +6% [Subscription: max]
Codex: Session: +19% | Weekly: +4% [Subscription: pro]

$ lazyusage --text
Claude: Session: 50% allowance used, 45% time elapsed, -5% capacity remaining (resets 1:20pm) | ...
Codex: Session: 5% allowance used, 24% time elapsed, 19% capacity remaining (resets 2:22pm) | ...
```

### JSON contract

Snapshot responses include resource-awareness metadata so agents can distinguish fresh data from fallback or cached data.

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

### Skill and prompt templates

The canonical agent skill lives at [`skills/lazyusage/SKILL.md`](skills/lazyusage/SKILL.md). It covers pre-flight capacity checks, adaptive throttling, stale/fallback-aware decision making, sleep-until-reset logic, service failover, and shared local server usage for multiple agents.

Copy-paste prompt templates for goal/loop agents:

- [`skills/lazyusage/templates/claude-goal-capacity.prompt.md`](skills/lazyusage/templates/claude-goal-capacity.prompt.md): Claude agent on a goal that may only spend a fixed share of remaining capacity
- [`skills/lazyusage/templates/codex-goal-capacity.prompt.md`](skills/lazyusage/templates/codex-goal-capacity.prompt.md): the same capacity-budget protocol for Codex agents (`5h` / `weekly` metric keys)
- [`skills/lazyusage/templates/claude-session-guard.prompt.md`](skills/lazyusage/templates/claude-session-guard.prompt.md): Claude agent that pauses itself near the 5-hour session limit

Runnable examples:

- [`examples/agent_integration.ts`](examples/agent_integration.ts)
- [`examples/agent_integration.sh`](examples/agent_integration.sh)
- [`examples/dashboard/README.md`](examples/dashboard/README.md)

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

## Collector daemon

For continuous history (and the TUI's Graph tab), run the always-on collector daemon. It samples usage on an interval and stores snapshots in the local SQLite database, so history accumulates even when the TUI is closed.

```text
  lazyusage daemon start                  TUI startup
        │                                     │
        ▼                                     ▼ daemon healthy?
  ┌──────────────┐    snapshots    ┌────────────────┐
  │  collector   │────────────────►│  SQLite store  │──► Graph tab, history,
  │ (60s cycle)  │                 └────────────────┘    predictions
  └──────────────┘                 TUI reads stored snapshots instead of
                                   starting its own collection chain
```

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

This is the foundation for capacity-management strategies: if the prediction says you will end the week with 30% spare, you can decide to dedicate that slice to unsupervised agent work and keep the rest for interactive sessions. The design document lives at [`docs/design/01-capacity_prediction.md`](docs/design/01-capacity_prediction.md).

## Local server

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

## Styling

The TUI ships with an intentional default theme instead of pretending to be fully themeable. An alternate monochrome palette is available for minimal terminals:

```bash
LAZYUSAGE_THEME=monochrome lazyusage
```

## Repository layout

```text
packages/
  core/      data collection, parsing, storage, formatting (publishable library)
  cli/       TUI application + CLI commands (publishable CLI)
  e2e/       end-to-end tests via tmux (private)
tests/       unit tests (core, cli, tui)
skills/      canonical agent skill + prompt templates
examples/    agent integration examples + browser dashboard
docs/        design documents (docs/design/) and research notes (docs/research/)
scripts/     build tooling
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide, and [ROADMAP.md](ROADMAP.md) for planned work.

```bash
bun install
bun run build
bun run test:core
bun run test:cli
bun run test:tui
bun run test:smoke
```

## License

[MIT](LICENSE)
