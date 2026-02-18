# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A TypeScript/Bun monorepo that provides interactive usage monitoring for Claude CLI and Codex CLI. The primary interface is an OpenTUI/SolidJS terminal dashboard with real-time metrics, usage charts, and per-project ledger data.

## Architecture

```
packages/
  core/   - Data collection, parsing, aggregation, formatting (pure TS)
  cli/    - TUI application + CLI commands (OpenTUI/SolidJS + Commander)
  e2e/    - E2E tests via tmux (resolution, soak, visual equivalency)
tests/
  tui/    - Unit/snapshot tests for hooks and components (Bun test)
  core/   - Unit tests for parsers and aggregators
examples/
  agent_integration.ts - Example: capacity check before spawning sub-agents
```

## Running the CLI

```bash
# Interactive TUI (default)
bun run usage

# Single-service TUI
bun run usage claude
bun run usage codex

# Text snapshot
bun run usage --text

# JSON snapshot
bun run usage --json

# Continuous NDJSON stream
bun run usage --json --live

# HTTP server
bun run usage --serve --port 3000
```

## Running Tests

```bash
# Core + hook unit tests
bun test tests/

# TUI component tests (requires OpenTUI preload)
bun run test:tui

# All E2E tests (requires tmux)
bun run test:e2e

# Visual equivalency tests (requires tmux + golden masters)
bun run test:visual

# Long-running soak test - 10 min (requires tmux)
bun run test:soak

# Regenerate golden masters
bun run capture-golden
```

## Key Architecture Details

### Data Flow

1. `PersistentFallbackChain` (core): API -> PTY -> cache -> fallback zeros
2. `UsageStore` (core): SQLite snapshot storage for history
3. `useLedgerData` (cli/tui): Reads JSONL files to build per-project usage ledger
4. `useMetrics` (cli/tui): Reactive signals for live metric state

### TUI Layout (OpenTUI/SolidJS)

- 2x2 grid: Claude row (bars left, stats right) + Codex row (bars left, stats right)
- `ServicePanel`: horizontal bar chart with time markers
- `StatsPanel`: tabbed stats panel (Daily / Weekly / Monthly ledger)
- `StatusBar`: data source, refresh interval, last updated time
- `HelpOverlay`: keyboard shortcut reference

### Bar Width Calculation

`calculateBarWidth(panelCols)` in `packages/core/src/utils/bars.ts`:
- Snaps to multiples of `BAR_WIDTH_STEP` (35 chars)
- Clamped between `MIN_BAR_WIDTH` (35) and `MAX_BAR_WIDTH` (315)

### Time Markers

`createTimeMarkers(divisions, barWidth)` places markers at equal intervals.
Equidistance is validated in E2E tests via `extractAllMarkers()` in `packages/e2e/src/helpers/markers.ts`.

### Service Filter

`App` accepts an optional `service?: "claude" | "codex" | "all"` prop.
`usage claude` shows only the Claude panel; `usage codex` only Codex.

## Modifying the Codebase

1. **Parser changes**: `packages/core/src/parsers/` - add `baseDir` parameter for testability
2. **New TUI components**: add to `packages/cli/src/tui/components/`, create snapshot test in `tests/tui/components/`
3. **New keybindings**: update `packages/cli/src/tui/hooks/useKeybindings.ts`
4. **E2E golden masters**: run `bun run capture-golden` after layout changes to update baselines

## Dependencies

- `bun` >= 1.3 - Runtime + package manager + test runner
- `@opentui/solid` + `@opentui/core` - TUI framework
- `solid-js` - Reactive UI framework
- `commander` - CLI argument parsing
- `better-sqlite3` - Snapshot storage
- `tmux` - Required for E2E tests only
