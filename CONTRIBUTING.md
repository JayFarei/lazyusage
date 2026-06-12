# Contributing to lazyusage

Thanks for your interest in contributing. This document covers everything you need to build, test, and submit changes.

## Prerequisites

- [Bun](https://bun.sh) `>= 1.3` (runtime, package manager, and test runner)
- `tmux` (only for end-to-end tests)
- macOS or Linux

## Setup

```bash
git clone https://github.com/jayfarei/lazyusage.git
cd lazyusage
bun install
bun run build
bun run lazyusage --help
```

`bun run build` pre-bundles the CLI into `packages/cli/dist/` for fast cold starts. During development you can skip the build and run from source:

```bash
bun run lazyusage:dev --json
```

## Repository layout

```
packages/
  core/   - Data collection, parsing, aggregation, formatting (pure TS)
  cli/    - TUI application + CLI commands (OpenTUI/SolidJS + Commander)
  e2e/    - E2E tests via tmux (resolution, soak, visual equivalency)
tests/
  core/   - Unit tests for parsers, chain, token refresh
  cli/    - Unit tests for CLI commands
  tui/    - Unit/snapshot tests for hooks and components
examples/ - Agent integration examples and browser dashboard
skills/   - Canonical agent skill (SKILL.md)
kb/       - Design documents and research notes
```

## Running tests

```bash
bun run test:core    # parsers, fallback chain, token refresh
bun run test:cli     # CLI command tests
bun run test:tui     # TUI hooks and components (needs OpenTUI preload, use the script)
bun run test:smoke   # build + packaged CLI smoke test
bun run test:e2e     # full E2E suite (requires tmux)
bun run test:visual  # visual equivalency against golden masters (requires tmux)
```

CI runs typecheck, lint, core, TUI, and CLI tests plus the build and smoke test on every pull request.

## Lint, format, typecheck

```bash
bun run lint        # biome check
bun run format      # biome format --write
bun run typecheck   # tsc --noEmit
```

Please run all three before opening a pull request.

## Golden masters

The visual E2E tests compare TUI output against golden snapshots in `packages/e2e/golden/`. If you intentionally change the layout or rendering:

```bash
bun run capture-golden
```

and commit the regenerated files along with your change.

## Making changes

1. **Parser changes**: `packages/core/src/parsers/`, keep the `baseDir` parameter so parsers stay testable.
2. **New TUI components**: add to `packages/cli/src/tui/components/` and create a snapshot test in `tests/tui/components/`.
3. **New keybindings**: update `packages/cli/src/tui/hooks/useKeybindings.ts` and the `HelpOverlay` component.
4. **After layout/component changes**: run `bun run build` so the dist bundle stays in sync, and regenerate golden masters if visuals changed.

Design context for larger subsystems (capacity prediction, the collector daemon) lives in `kb/plans/`.

## Pull requests

- Keep PRs focused, one logical change per PR.
- Include tests for new behavior.
- Make sure `bun run typecheck`, `bun run lint`, and the test suites pass.
- Describe what changed and why in the PR body.

## Reporting issues

Please include your OS, Bun version, which CLIs you monitor (Claude/Codex), and the output of `lazyusage usage-check --json-only` (it redacts credentials, but double-check before pasting).
