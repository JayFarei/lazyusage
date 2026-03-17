# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
