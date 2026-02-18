# usage-tui

A TypeScript/Bun monorepo for monitoring Claude CLI and Codex CLI usage statistics. Provides an interactive terminal dashboard (TUI), quick text snapshots, JSON output for agents, and an HTTP server mode.

## Features

- **Interactive TUI**: Real-time bar charts, per-project ledger, keyboard navigation
- **Multi-source fetching**: API-first with intelligent fallback (API → PTY → cache → zeros)
- **Fast**: ~1s via API (vs ~8s via PTY), graceful degradation when API is unavailable
- **Usage history**: SQLite snapshots with deduplication, 30-day retention
- **Per-project ledger**: Reads JSONL session files to show usage broken down by project (daily/weekly/monthly)
- **Service filtering**: Monitor Claude, Codex, or both
- **Multiple output modes**: Interactive TUI, text snapshot, JSON, NDJSON stream, HTTP server
- **Agent-friendly**: JSON output with availability metadata for programmatic consumption
- **Source transparency**: Shows where data came from (api / pty / cache)

## Requirements

- [Bun](https://bun.sh) >= 1.3
- Claude CLI (`claude`) and/or Codex CLI (`codex`) in PATH
- tmux (optional, used as PTY fallback and for E2E tests)

## Installation

```bash
git clone <repo>
cd usage-tui-opentui
bun install
```

## Usage

### Interactive TUI (default)

```bash
bun run usage           # Both Claude + Codex panels
bun run usage claude    # Claude panel only
bun run usage codex     # Codex panel only
```

### Keyboard controls (TUI)

| Key | Action |
|-----|--------|
| `1` / `2` | Focus Claude / Codex panel |
| `j` / `k` | Navigate metrics up/down |
| `[` / `]` | Cycle stats tab (Daily / Weekly / Monthly) |
| `r` | Force refresh now |
| `p` | Pause / resume auto-refresh |
| `+` / `-` | Speed up / slow down refresh interval |
| `?` | Toggle help overlay |
| `q` | Quit |

### Text snapshot

```bash
bun run usage --text            # Both services
bun run usage claude --text     # Claude only
```

### JSON output (agent use)

```bash
# Single snapshot to stdout
bun run usage --json

# Continuous NDJSON stream
bun run usage --json --live

# Specific service
bun run usage claude --json
```

### HTTP server

```bash
bun run usage --serve               # Port 8080
bun run usage --serve --port 3000   # Custom port
```

Endpoints: `GET /usage` (JSON snapshot), `GET /usage/stream` (SSE stream).

### Quick usage check (for agents, scripts)

```bash
bun run usage-check             # Text output, auto-detect services
bun run usage-check claude      # Claude only
bun run usage-check --json      # JSON output
bun run usage-check --debug     # Show timing and data source
```

## JSON output schema

```json
{
  "services": [
    {
      "name": "claude",
      "available": true,
      "source": "api",
      "metrics": [
        { "name": "session", "used_pct": 12, "remaining_pct": 88, "resets": "3:45pm" },
        { "name": "week_all", "used_pct": 5, "remaining_pct": 95, "resets": "Feb 24 at 9:00am" },
        { "name": "week_sonnet", "used_pct": 8, "remaining_pct": 92, "resets": "Feb 24 at 9:00am" }
      ]
    },
    {
      "name": "codex",
      "available": true,
      "source": "api",
      "metrics": [
        { "name": "5h", "used_pct": 0, "remaining_pct": 100, "resets": "6:12pm" },
        { "name": "weekly", "used_pct": 2, "remaining_pct": 98, "resets": "Feb 24 at 9:00am" }
      ]
    }
  ]
}
```

## Agent integration

### TypeScript / Bun

```typescript
import { $ } from "bun";

const output = await $`bun run usage claude --json`.text();
const data = JSON.parse(output);
const metric = data.services[0].metrics.find(m => m.name === "session");
if (metric.remaining_pct < 20) {
  console.log("Low capacity - deferring");
}
```

See [`examples/agent_integration.ts`](examples/agent_integration.ts) for a full example.

### Bash

```bash
json=$(bun run usage-check claude --json)
remaining=$(echo "$json" | jq '.services[0].metrics | min_by(.remaining_pct) | .remaining_pct')
[ "$remaining" -lt 20 ] && echo "Low capacity" || echo "OK"
```

See [`examples/agent_integration.sh`](examples/agent_integration.sh) for a full example.

## Project structure

```
usage-tui-opentui/
├── packages/
│   ├── core/                  # Data collection + formatting (pure TS)
│   │   └── src/
│   │       ├── providers/     # API / PTY / cache / chain
│   │       ├── parsers/       # Claude + Codex JSONL parsers (ledger)
│   │       ├── collectors/    # PTY-based collectors
│   │       ├── formatters/    # Text + JSON output
│   │       ├── storage/       # SQLite snapshot store
│   │       └── utils/         # bars, time, tmux helpers
│   ├── cli/                   # TUI + CLI commands (OpenTUI/SolidJS)
│   │   └── src/
│   │       ├── commands/      # usage, usage-check CLI commands
│   │       ├── server/        # HTTP server mode
│   │       └── tui/           # SolidJS TUI components + hooks
│   └── e2e/                   # E2E tests via tmux
│       ├── src/helpers/       # tmux, assertions, markers, golden
│       ├── src/tests/         # resolution, soak, visual-equivalency
│       ├── golden/            # Captured baseline frames (4 resolutions)
│       └── scripts/           # capture-golden.ts
├── tests/
│   ├── core/                  # Parser + aggregator unit tests
│   └── tui/                   # Hook + component snapshot tests
├── examples/
│   ├── agent_integration.ts
│   └── agent_integration.sh
├── CLAUDE.md                  # Codebase guidance for Claude Code
├── package.json               # Bun workspace root + scripts
└── tsconfig.json
```

## Running tests

```bash
# Core parser + aggregator unit tests
bun test tests/core/

# TUI hook + component snapshot tests
bun run test:tui

# E2E tests at 5 terminal sizes (requires tmux)
bun run test:e2e

# Visual equivalency vs golden masters (requires tmux)
bun run test:visual

# 10-minute soak test (requires tmux)
bun run test:soak

# Regenerate golden masters after layout changes
bun run capture-golden
```

## Architecture

### Data flow

```
API provider  ──┐
PTY provider  ──┼──► PersistentFallbackChain ──► UsageStore (SQLite)
Cache         ──┘                                      │
                                                  useMetrics()
                                                       │
JSONL session files ──► useLedgerData() ────────► App.tsx (SolidJS)
```

### Data sources (in priority order)

1. **API** - Direct HTTPS to Claude/Codex APIs. Reads OAuth tokens from Keychain (Claude) or `~/.codex/auth.json` (Codex). ~1s.
2. **PTY** - Launches CLI in a tmux pane, captures output. ~8s.
3. **Cache** - Last-known-good data from SQLite snapshot store. Instant, but may be stale.
4. **Fallback** - Zero values with calculated reset times. Always succeeds.

### TUI layout

```
┌─ Claude CLI ──────────────┐ ┌─ Daily ── Weekly ── Monthly ─┐
│ ▓▓▓▓▓░░░░░░░░░░░░░░ ⏱ 22% │ │  project-a     1,234  45%   │
│ ┃    ┃    ┃    ┃          │ │  project-b       890  32%   │
│ ▓▓░░░░░░░░░░░░░░░░░ ⏱  8% │ │  other           789  23%   │
│ ┃    ┃    ┃    ┃          │ │  Total         2,913        │
└───────────────────────────┘ └──────────────────────────────┘
┌─ Codex CLI ───────────────┐ ┌──────────────────────────────┐
│ ▓░░░░░░░░░░░░░░░░░░ ⏱  2% │ │  (Codex ledger)              │
│ ┃    ┃    ┃    ┃          │ │                              │
└───────────────────────────┘ └──────────────────────────────┘
Auto-refresh: ON  10s  │  Last: 3:45:12 PM  │  Source: api
[1]Claude [2]Codex  j/k=Navigate  [/]=Tab  r=Refresh  p=Pause  ?=Help  q=Quit
```

## Troubleshooting

### "No CLI tools found"

Install Claude CLI and/or Codex CLI and ensure they're in PATH:

```bash
which claude
which codex
```

### Slow (using PTY instead of API)

Check the data source:

```bash
bun run usage-check claude --debug
# Should show "Source: api" (~1s)
# If "Source: pty" (~8s), check credentials below
```

If stuck on PTY, check credentials:

```bash
# Claude - Keychain
security find-generic-password -s "Claude Code-credentials" -w
# or file
cat ~/.claude/.credentials.json

# Codex - file
cat ~/.codex/auth.json
```

Running `claude` or `codex` once will refresh tokens if expired.

### Stale data ("cache" source)

Both API and PTY failed - using last snapshot. Check:

1. Network connectivity
2. CLI tools work: `claude`, `codex`
3. Tokens may be expired - run the CLIs manually to refresh

### SQLite database issues

```bash
# Default location
ls ~/.local/share/usage-cli/usage.db

# Reset if corrupted
mv ~/.local/share/usage-cli/usage.db ~/.local/share/usage-cli/usage.db.bak

# Query directly
sqlite3 ~/.local/share/usage-cli/usage.db "SELECT * FROM usage_snapshots ORDER BY timestamp DESC LIMIT 5;"
```

## Performance

| Mode | API available | PTY fallback |
|------|--------------|--------------|
| `usage-check` (single) | ~1s | ~8-15s |
| TUI initial load | ~1-2s | ~8-15s |
| TUI refresh | ~1s | ~2-3s (reuses pane) |

Storage: ~280KB/day at 10s refresh. Auto-cleanup removes >30 days on startup.

## License

MIT - see [LICENSE](LICENSE).
