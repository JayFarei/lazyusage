# lazyusage

A TypeScript/Bun monorepo for monitoring Claude CLI and Codex CLI usage. Provides an interactive terminal dashboard (TUI), quick text snapshots, JSON output for agents, and an HTTP server mode.

## Features

- **Interactive TUI** - Real-time bar charts, per-project ledger, keyboard navigation
- **Multi-source fetching** - API-first with intelligent fallback (API -> token refresh -> PTY -> cache -> zeros)
- **Fast** - ~1s via API (vs ~8s via PTY), graceful degradation when API is unavailable
- **OAuth token refresh** - Automatically refreshes expired tokens before falling back to PTY
- **Usage history** - SQLite snapshots with deduplication, 30-day auto-cleanup
- **Per-project ledger** - Reads JSONL session files to show usage by project (daily/weekly/monthly)
- **Service filtering** - Monitor Claude, Codex, or both
- **Multiple output modes** - TUI, text snapshot, JSON, NDJSON stream, HTTP server
- **Web dashboard** - React + Vite example UI that consumes the HTTP/SSE server endpoint
- **Agent-friendly** - JSON output + SKILL.md with strategies for capacity management
- **Buildable** - Pre-bundle with `bun run build` for faster cold starts

## Requirements

- [Bun](https://bun.sh) >= 1.3
- Claude CLI (`claude`) and/or Codex CLI (`codex`) in PATH
- tmux (optional, used as PTY fallback and for E2E tests)

## Installation

```bash
git clone <repo>
cd lazyusage
bun install
```

## Usage

### Interactive TUI (default)

```bash
bun run build              # One-time: pre-bundle for fast startup
bun run lazyusage              # Both Claude + Codex panels
bun run lazyusage claude       # Claude panel only
bun run lazyusage codex        # Codex panel only
```

For development (no build step, uses Babel transform at runtime):

```bash
bun run lazyusage:dev
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
bun run lazyusage:dev --text            # Both services
bun run lazyusage:dev claude --text     # Claude only
```

### JSON output (agent use)

```bash
# Single snapshot
bun run lazyusage --json

# Continuous NDJSON stream
bun run lazyusage --json --live

# Specific service
bun run lazyusage claude --json
```

### HTTP server

```bash
bun run lazyusage --serve               # Port 8080
bun run lazyusage --serve --port 3000   # Custom port
```

Endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /` | JSON snapshot of all metrics |
| `GET /health` | Server health + service list |
| `GET /stream` | SSE stream, emits JSON on every refresh |
| `GET /claude` | JSON snapshot for Claude only |
| `GET /codex` | JSON snapshot for Codex only |
| `GET /stream/claude` | SSE stream for Claude only |
| `GET /stream/codex` | SSE stream for Codex only |

### Web dashboard (example)

A React + Vite proof-of-concept dashboard that connects to the SSE stream and displays live usage bars in a browser:

```bash
# 1. Start the server
bun run lazyusage --serve --port 8080

# 2. In a separate terminal
cd examples/dashboard
npm install
npm run dev
# Open http://localhost:5173
```

Port is configurable via query param: `http://localhost:5173?port=3000`

See [`examples/dashboard/README.md`](examples/dashboard/README.md) for full details.

### Quick usage check (for agents, scripts)

```bash
bun run lazyusage-check             # Text output
bun run lazyusage-check claude      # Claude only
bun run lazyusage-check --json      # JSON output
bun run lazyusage-check --debug     # Show timing and data source
```

## JSON output schema

```json
{
  "timestamp": "2026-02-19T17:55:25.572Z",
  "available_services": ["claude", "codex"],
  "services": [
    {
      "name": "claude",
      "available": true,
      "subscription_type": "max",
      "metrics": [
        { "name": "session",     "used_pct": 26, "remaining_pct": 74, "resets": "9:00pm" },
        { "name": "week_all",    "used_pct": 19, "remaining_pct": 81, "resets": "Feb 25 at 11:00am" },
        { "name": "week_sonnet", "used_pct": 18, "remaining_pct": 82, "resets": "Feb 25 at 11:00am" }
      ]
    },
    {
      "name": "codex",
      "available": true,
      "subscription_type": "Plus",
      "metrics": [
        { "name": "5h",     "used_pct": 6,  "remaining_pct": 94, "resets": "11:18pm" },
        { "name": "weekly", "used_pct": 14, "remaining_pct": 86, "resets": "Feb 23 at 9:59pm" }
      ]
    }
  ]
}
```

## Agent integration

[`examples/SKILL.md`](examples/SKILL.md) is the primary reference for agents. It covers 6 scenarios: pre-flight capacity check, adaptive throttling, sleep-until-reset, service failover, continuous monitoring, and multi-agent shared server.

### Quick check

```bash
# Exit 1 if any metric below 20%
bun run lazyusage-check claude --json | jq -e \
  '.services[0].metrics | all(.remaining_pct >= 20)' > /dev/null
```

### Runnable examples

- [`examples/agent_integration.ts`](examples/agent_integration.ts) - Full agentic loop (TypeScript)
- [`examples/agent_integration.sh`](examples/agent_integration.sh) - Full agentic loop (bash)
- [`examples/dashboard/`](examples/dashboard/) - React + Vite web dashboard (see [README](examples/dashboard/README.md))

## Project structure

```
lazyusage/
├── packages/
│   ├── core/                  # Data collection + formatting (pure TS)
│   │   └── src/
│   │       ├── providers/     # API / PTY / cache / chain / credentials
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
│   ├── core/                  # Parser, chain, token-refresh unit tests
│   └── tui/                   # Hook + component snapshot tests
├── examples/
│   ├── SKILL.md               # Agent skill: capacity management scenarios
│   ├── agent_integration.ts   # Full agentic capacity loop (TypeScript)
│   ├── agent_integration.sh   # Full agentic capacity loop (bash)
│   └── dashboard/             # React + Vite web dashboard POC
│       ├── src/               # App, hooks, components
│       ├── e2e/               # agent-browser E2E test suite
│       └── README.md          # Quick start
├── scripts/
│   └── build.ts               # Pre-bundle CLI for fast cold starts
├── SKILL.md                   # Agent guide: capacity strategies
├── CLAUDE.md                  # Codebase guidance for Claude Code
├── package.json               # Bun workspace root + scripts
└── tsconfig.json
```

## Running tests

```bash
# Core unit tests (parsers, chain, token refresh)
bun test tests/core/

# TUI hook + component snapshot tests
bun run test:tui

# Web dashboard E2E tests (agent-browser, starts servers automatically)
bun run test:dashboard

# E2E tests at 5 terminal sizes (requires tmux)
bun run test:e2e

# Visual equivalency vs golden masters (requires tmux)
bun run test:visual

# 10-minute soak test (requires tmux)
bun run test:soak

# Regenerate golden masters after layout changes
bun run capture-golden
```

## Building

```bash
bun run build
```

Pre-bundles the CLI and ledger worker into `dist/` using the SolidJS transform plugin. Eliminates Babel/JSX transform at launch time for faster cold starts. The `bun run lazyusage` script runs from the built bundle.

## Architecture

### Data flow

```
API provider  ──┐
                ├──► PersistentFallbackChain ──► UsageStore (SQLite)
Token refresh ──┤         (with retry)                  │
PTY provider  ──┤                                  useMetrics()
Cache         ──┘                                       │
                                                  App.tsx (SolidJS)
                                                        │
JSONL session files ──► useLedgerData() ────────────────┘
```

### Data sources (in priority order)

1. **API** - Direct HTTPS to Claude/Codex APIs. Reads OAuth tokens from Keychain (Claude) or `~/.codex/auth.json` (Codex). ~1s.
2. **Token refresh** - If API fails with expired token, attempts OAuth refresh before falling back.
3. **PTY** - Launches CLI in a tmux pane, captures output. ~8s.
4. **Cache** - Last-known-good data from SQLite snapshot store. Instant, but may be stale.
5. **Fallback** - Zero values with calculated reset times. Always succeeds.

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
bun run lazyusage-check claude --debug
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

Both API and PTY failed, using last snapshot. Check:

1. Network connectivity
2. CLI tools work: `claude`, `codex`
3. Tokens may be expired - run the CLIs manually to refresh

### SQLite database issues

```bash
# Default location
ls ~/.local/share/lazyusage/usage.db

# Reset if corrupted
mv ~/.local/share/lazyusage/usage.db ~/.local/share/lazyusage/usage.db.bak

# Query directly
sqlite3 ~/.local/share/lazyusage/usage.db "SELECT * FROM usage_snapshots ORDER BY timestamp DESC LIMIT 5;"
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
