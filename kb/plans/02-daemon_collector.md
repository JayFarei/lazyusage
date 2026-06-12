# Always-On Collector Daemon

**Status:** Implemented
**Date:** 2026-04-09
**Completed:** 2026-04-10
**Designed via:** /grill-me (12-question design interview)

## Overview

A lightweight, headless background process that continuously collects usage snapshots every 60 seconds and writes them to the existing SQLite database. When the daemon is installed and running, the TUI gains a new **Graph tab** showing consumption vs pace vs predicted as a braille time-series chart.

If the daemon is not installed, the TUI works exactly as it does today. No degradation, no missing features beyond the graph.

**Core idea:** the TUI is interactive and ephemeral, the daemon is always-on and persistent. The daemon fills the gaps between TUI sessions, giving the prediction model continuous data and enabling a real-time graph view that shows the full consumption story over a billing window.

## Completion Notes

Implementation now covers:
- daemon config, logging, lifecycle, collection loop, heartbeat persistence, and service installation paths
- daemon CLI management (`start`, `stop`, `status`, `logs`, `install`, `uninstall`)
- daemon-aware TUI startup, daemon-backed on-demand refresh, and conditional Graph tab visibility
- inline and fullscreen daemon-backed graph rendering with braille time-series output, pace/prediction overlays, and live window markers
- verification via core tests, TUI tests, and a production build

### Design Principles

- **Zero-config by default.** `lazyusage daemon start` just works. No setup step required.
- **Full fallback chain.** API first, PTY fallback when rate-limited. Accept an occasional missed minute, never accumulate gaps.
- **Lightweight.** No tmux. Direct PTY via openpty FFI. Warm standby with periodic recycling.
- **Graceful absence.** No daemon = no Graph tab. Everything else unchanged.
- **Never crash on recoverable errors.** Log, skip, retry next cycle.


## Architecture

### Data Flow

```
Daemon Process (60s loop)
  |
  +-- PersistentFallbackChain (reuses existing core infrastructure)
  |     |-- ClaudeAPIProvider (OAuth)
  |     |-- ClaudeWebProvider (browser cookies)
  |     +-- ClaudePersistentPTYProvider (Direct PTY, warm standby)
  |
  +-- UsageStore.storeSnapshot()  --> usage_snapshots table (existing)
  +-- DaemonStatus.heartbeat()    --> daemon_status table (new)
  +-- DaemonLogger.log()          --> ~/.local/share/lazyusage/daemon.log
```

### Daemon-TUI Coexistence

```
Without daemon:                    With daemon:
  TUI owns chain + writes DB         Daemon owns chain + writes DB
  TUI refreshes every 10s            TUI reads DB, skips own chain
  No Graph tab                       Graph tab visible (braille chart)
                                     'r' key: TUI does one-shot fetch
```

The TUI detects the daemon via two signals:
1. **PID file** (`~/.local/share/lazyusage/daemon.pid`) -- quick "is it running?"
2. **Heartbeat table** (`daemon_status` in SQLite) -- "is it running AND healthy?" (last_collected_at within 2 minutes)


## Daemon Process

### Collection Loop

```
on startup:
  load config (file + CLI flag overrides)
  open UsageStore (existing SQLite DB)
  create daemon_status table if not exists
  write PID file
  initialize PersistentFallbackChain for each service
  warm up PTY standby sessions

every 60 seconds:
  for each service (claude, codex):
    result = chain.refresh()
    if result.metrics:
      store.storeSnapshot(result.metrics)
      status.heartbeat(service, ok, source)
    else:
      status.heartbeat(service, error, reason)
      log warning

  every 4 hours:
    recycle PTY sessions (winddown + windup)

on SIGTERM/SIGINT:
  winddown all PTY sessions
  flush DB
  remove PID file
  exit 0
```

### Provider Strategy

The daemon uses the full `PersistentFallbackChain` from `packages/core`:
- **Normal operation:** API providers handle collection. Lightweight HTTP requests.
- **Rate-limited:** Chain falls through to Direct PTY (`PersistentDirectSession`). No tmux, uses openpty FFI.
- **PTY warm standby:** One `PersistentDirectSession` per service kept alive but idle. Queried instantly on API fallback. Recycled every ~4 hours to prevent memory creep.
- **Total failure:** Log error, skip cycle, write nothing. Retry next minute. After 10 consecutive failures, log error-level alert.

### Resilience Model

| Failure | Response |
|---------|----------|
| API 429 / auth expired | Chain falls through to PTY. Logged as info. |
| All providers fail | Skip cycle, log warning. Retry next minute. |
| 10 consecutive full failures | Log error-level alert. Keep retrying. |
| SQLite write failure | Retry once after 1s. If still failing, skip. |
| PTY session dies | Auto-recycle on next `isAlive()` check. |
| Unhandled exception | Top-level catch, log stack trace, continue loop. |
| **Principle** | **The daemon never exits on a recoverable error.** |


## CLI Commands

### `lazyusage daemon start`

Self-forks into background. Writes PID file. Prints PID and log path.

```bash
lazyusage daemon start                          # defaults: 60s, both services
lazyusage daemon start --interval 120            # 2-minute cadence
lazyusage daemon start --services claude         # claude only
lazyusage daemon start --foreground              # no fork, logs to stdout (debugging)
```

### `lazyusage daemon stop`

Reads PID file, sends SIGTERM, waits for graceful shutdown (up to 5s), confirms.

### `lazyusage daemon status`

Checks PID file (process alive?), reads `daemon_status` heartbeat (last collection, error count, uptime). Prints a one-line summary.

```
Daemon: running (pid 12345, uptime 3d 4h)
  Claude: last collected 23s ago (source: api)
  Codex:  last collected 23s ago (source: api)
  Errors: 0 in last hour
```

### `lazyusage daemon logs`

Tails `~/.local/share/lazyusage/daemon.log`. Accepts `--lines N` and `--follow`.

### `lazyusage daemon install`

Generates and loads a platform-specific service definition:
- **macOS:** launchd plist at `~/Library/LaunchAgents/com.lazyusage.daemon.plist`
- **Linux:** systemd user unit at `~/.config/systemd/user/lazyusage-daemon.service`

Auto-start on boot, auto-restart on crash. Bakes current config into the service definition.

### `lazyusage daemon uninstall`

Stops the service, removes the service definition, removes PID file.


## Configuration

### Zero-Config Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `interval` | `60` | Collection cadence in seconds |
| `services` | `["claude", "codex"]` | Which services to collect |
| `log_level` | `"info"` | Log verbosity (debug, info, warn, error) |
| `log_max_size` | `"5MB"` | Max log file size before rotation |
| `log_keep` | `3` | Number of rotated log files to keep |
| `pty_recycle_hours` | `4` | PTY session recycling interval |

### Optional Config File

`~/.config/lazyusage/daemon.toml`

```toml
interval = 60
services = ["claude", "codex"]
log_level = "info"

[pty]
recycle_hours = 4

[logging]
max_size = "5MB"
keep = 3
```

CLI flags override config file values. Config file is optional, daemon works without it.


## SQLite Schema Additions

### `daemon_status` Table (new)

```sql
CREATE TABLE daemon_status (
  service TEXT PRIMARY KEY,              -- 'claude', 'codex', '_daemon'
  last_collected_at TEXT,                -- ISO 8601
  last_source TEXT,                      -- DataSource enum value
  last_error TEXT,                       -- null if last cycle succeeded
  consecutive_failures INTEGER DEFAULT 0,
  pid INTEGER,
  started_at TEXT,                       -- daemon process start time
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

The `_daemon` row tracks the process itself (pid, started_at). Per-service rows track collection health.

No changes to the existing `usage_snapshots` or `capacity_marks` tables. The daemon writes the same rows the TUI does today.


## Graph Tab (TUI)

### Visual Model

```
 100%|......................................................./
     |                                                    /  .
     |                                              ____/   .
     |                                         ____/       .
     |                                    ____/           .    <-- prediction line
     |                               ____/               .
     |                          ____/      .            .
     |                    _____/          .           .
     |              _____/               .          .         <-- pace diagonal
     |        _____/                    .         .
     |  _____/            NOW |        .        .
     | /                      |       .       .
     |/                       |      .      .               <-- consumption curve
   0%+----|----|----|----|----|----|----|----+
     Mon  Tue  Wed  Thu  Fri  Sat  Sun
```

### Elements

- **X-axis:** Window start to window end
  - Weekly metrics: day gridlines (thin vertical lines at day boundaries)
  - Session/5h metrics: hour gridlines
- **Y-axis:** 0% to scaled ceiling (accommodates >100% predictions)
  - 100% mark rendered as a highlighted horizontal threshold line
- **Pace diagonal:** Straight line from (start, 0%) to (end, 100%). The "even consumption" reference.
- **Consumption curve:** Actual `used_pct` from daemon snapshots over time. Rendered in braille.
- **Prediction line:** From current data point to projected end-of-window value. Dashed or dimmer style.
- **Vertical "now" bar:** Full-height vertical line at current time position. Sweeps rightward.

### Reading the Chart

- Consumption curve **below** pace diagonal = ahead of budget, capacity to spare
- Consumption curve **above** pace diagonal = burning faster than sustainable
- Prediction line crossing 100% threshold = projected to hit the cap before window ends

### Layout

- **Tab placement:** 4th tab in StatsPanel, alongside Daily / Weekly / Monthly
- **Only visible** when daemon data exists (checked via `daemon_status` heartbeat)
- **Adaptive display:**
  - In panel: shows the chart for the currently selected metric in ServicePanel
  - In fullscreen (`f` key): shows both weekly + session charts stacked vertically
- **Braille rendering:** Unicode braille characters (U+2800-U+28FF), 2x4 dot grid per cell. Coordinate-to-codepoint mapping via bit manipulation. No external charting library.


## Implementation Phases

### Phase 1: Daemon Core
**Files:** `packages/core/src/daemon/`

1. `collector.ts` — Main collection loop (60s timer, chain.refresh, store.storeSnapshot)
2. `lifecycle.ts` — Fork, PID file, signal handling, graceful shutdown
3. `config.ts` — Config file loading + CLI flag merge + defaults
4. `logger.ts` — File logger with rotation (extend existing `utils/logger.ts`)
5. `status.ts` — `daemon_status` table creation, heartbeat writes, health queries
6. Schema migration in `storage/database.ts` — add `daemon_status` table

### Phase 2: CLI Commands
**Files:** `packages/cli/src/commands/daemon.ts`

1. `daemon start` — fork + start collection loop
2. `daemon stop` — PID read + SIGTERM
3. `daemon status` — PID check + heartbeat read + formatted output
4. `daemon logs` — file tail with `--lines` and `--follow`
5. `daemon install` / `daemon uninstall` — launchd plist + systemd unit generation

### Phase 3: TUI Integration
**Files:** `packages/cli/src/tui/`

1. Daemon detection in `App.tsx` — check heartbeat, skip chain init if daemon is healthy
2. On-demand refresh (`r` key) — one-shot fetch even when daemon is active
3. Graph tab visibility — conditionally add tab when daemon data exists

### Phase 4: Braille Chart
**Files:** `packages/core/src/chart/` + `packages/cli/src/tui/components/`

1. `braille.ts` — Coordinate-to-braille renderer (bit manipulation, canvas abstraction)
2. `timeseries.ts` — Time-series plotting (data points to canvas coordinates, line drawing)
3. `axes.ts` — Axis rendering (Y-axis labels, X-axis gridlines, threshold line at 100%)
4. `GraphPanel.tsx` — TUI component composing chart + axes + legend
5. Fullscreen graph view — stacked weekly + session charts
6. `pace.ts` in `packages/core/src/storage/` already has `buildPaceData()`, extend for chart data

### Phase 5: Testing

1. Unit tests for daemon collection loop (mocked chain + store)
2. Unit tests for braille renderer (coordinate mapping, known patterns)
3. Unit tests for daemon detection logic (heartbeat freshness)
4. E2E: daemon start/stop/status lifecycle
5. E2E: TUI with daemon running (Graph tab visible, data renders)
6. Soak test: daemon running for extended period, verify no gaps, memory stable


## Open Questions (deferred, not blocking)

- **Q1:** Should `daemon install` offer a `--user` vs `--system` flag for systemd? (Default: user unit)
- **Q2:** Should the daemon expose an optional HTTP health endpoint for external monitoring? (Not needed for TUI, but useful for VPS setups with uptime checks)
- **Q3:** Chart color scheme — should the three lines (consumption, pace, prediction) use distinct colors, or is bold/dim/dashed sufficient for monochrome terminals?
