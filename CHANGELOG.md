# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 2026-06-12

### Fixed
- `lazyusage --version` now reports the real package version (was hardcoded to 0.1.0)

## [0.2.1] - 2026-06-12

### Fixed
- `lazyusage@0.2.0` was published with a stale `lazyusage-core@0.1.0` dependency (workspace version substituted from an outdated lockfile) and could not install; deprecated in favor of 0.2.1

## [0.2.0] - 2026-06-12

### Changed
- npm package names: the CLI publishes as `lazyusage` and the library as `lazyusage-core` (unscoped)

### Added
- Always-on collector daemon: `lazyusage daemon start|stop|status|logs`
- Background service install: `lazyusage daemon install|uninstall` (launchd on macOS, systemd user unit on Linux)
- Optional daemon configuration at `~/.config/lazyusage/daemon.toml`
- TUI hydrates from daemon snapshots when the daemon is healthy, skipping its own collection chain
- Graph tab in the stats panel for daemon-backed services (Tab cycles Daily, Weekly, Monthly, Graph)
- Capacity prediction: `--predict` shows projected spare capacity at window end
- `lazyusage plan` command for marking upcoming days with expected work intensity (L/M/H/B regimes)
- CONTRIBUTING.md and expanded README (daemon, prediction, tmux popup setup, agent capacity budgets)
- Copy-paste goal capacity prompt templates for Claude and Codex agents (`skills/lazyusage/templates/`)

### Fixed
- Collector tmux sessions no longer pile up: sessions created by this process are killed on exit, and stale sessions leaked by force-killed runs (e.g. a closed tmux popup) are reaped on the next run
- PTY collection fails fast when the target CLI is not installed instead of polling a dead tmux session for ~12s per service
- Narrow panels now truncate the border title (dropping the subscription suffix) instead of losing it entirely
- `pty_helpers.c` is now copied into both dist outputs so installed packages can compile the PTY helper at runtime

## [0.1.0] - 2026-03-17

### Added
- Interactive OpenTUI/SolidJS terminal dashboard with real-time metrics
- 2x2 grid layout: Claude row + Codex row, each with bars and stats panels
- Per-project token usage ledger (Daily/Weekly/Monthly tabs)
- `--text` and `--json` CLI output modes for agent integration
- `--capacity` flag for compact capacity-remaining output
- `--serve` HTTP server with polling and SSE streaming endpoints
- `--json-only` machine-safe JSON output (errors as JSON on stdout)
- OAuth token refresh with Keychain + file persistence
- PersistentFallbackChain: API -> token refresh -> PTY -> cache -> fallback zeros
- SQLite snapshot storage with 30-day auto-cleanup
- Circuit breaker (RefreshFailureGate) with exponential backoff for token refresh
- Dedup tracker to avoid redundant storage writes
- Structured logging with configurable log levels
- Service warnings system (rate limits, stale data, capacity alerts)
- Keyboard navigation, fullscreen metric view, help overlay
- Pre-bundled CLI for fast cold starts (`bun run build`)

### Security
- Credential redaction in logs
- File permissions (0o600) for persisted credentials
- Input validation on CLI arguments
- Rate limit handling with automatic backoff
