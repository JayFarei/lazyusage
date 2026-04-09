# LazyUsage Chart Rendering: Self-Scouting Brief

> Research date: 2026-03-26
> Source: /Users/jayfarei/src/tries/2026-02-05-test-usage-via-cli
> Category: self-analysis (rendering architecture)

---

## Overview

LazyUsage renders terminal charts using **OpenTUI + SolidJS**, a high-performance TUI framework with a Zig native core. Charts are built from Unicode block characters composed via SolidJS JSX into OpenTUI's `<box>` and `<text>` primitives. There is **no custom canvas, no pixel-level rendering, no Rust** anywhere in the stack.

## How Charts Are Currently Rendered

### The Rendering Pipeline

```
SolidJS JSX (.tsx)
  | [babel-preset-solid, generate:"universal" — compile time via Bun plugin]
  v
SolidJS reactive graph (createSignal, createMemo, createEffect)
  | [@opentui/solid reconciler — createElement/insertNode/setProperty]
  v
Renderable tree (BoxRenderable, TextRenderable, ScrollBoxRenderable, ...)
  | [Yoga WASM 3.2.1 — calculateLayout() on YogaNode tree]
  v
Absolute x/y/width/height on each Renderable
  | [Renderable.render(OptimizedBuffer, deltaTime) — JS side]
  v
OptimizedBuffer (native Zig memory via bun:ffi ptr)
  — char: Uint32Array, fg: Float32Array, bg: Float32Array, attributes: Uint32Array
  — drawBox, drawText, fillRect, setCell, pushScissorRect, pushOpacity
  | [libopentui.dylib — CliRenderer.renderNative() -> lib.render(rendererPtr, force)]
  v
Diff next buffer vs current buffer (pure Zig, inside libopentui.dylib)
  | [ANSI escape sequences written to stdout]
  v
Terminal display (60 FPS, dirty-rectangle optimization)
```

**Key insights**:
- SolidJS has no virtual DOM. `babel-preset-solid` compiles JSX at build time into direct imperative calls on OpenTUI renderables. More efficient than React's reconciliation.
- Layout (Yoga) runs in WASM on the JS side. The computed positions feed into the Zig native buffer, which handles diffing and ANSI output.
- `@opentui/core` v0.1.77 loads `libopentui.dylib` (Zig-compiled) via `Bun.dlopen()`. Platform binaries exist for darwin-arm64/x64, linux-arm64/x64, win32-arm64/x64.
- `@opentui/solid` and `solid-js` are bundled together (not external) to ensure a single shared reactive runtime.

### Chart Components

There are **two distinct visualization types**:

#### 1. Horizontal Capacity Bars (`ServicePanel.tsx`)

**File**: `packages/cli/src/tui/components/ServicePanel.tsx`

The primary visualization. Each metric renders a vertical stack:

```
> Session (5h)                          <- label (bold, colored)
  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░ * 42% <- capacity bar
       |         |         |            <- time markers (dim)
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░ ⏱ 55% <- period bar
    Resets: 4:00pm (2h 15m left)        <- reset countdown
```

**How bars are built** (`packages/core/src/utils/bars.ts`):

| Function | Characters | Purpose |
|----------|-----------|---------|
| `createCapacityBar(usedPct, width)` | `▓` filled + `░` empty | Shows % of allowance consumed |
| `createPeriodBar(timePct, width)` | `▓` filled + `░` empty | Shows % of time window elapsed |
| `createPredictionBar(used, predicted, width)` | `▓` used + `▒` predicted + `░` spare | 3-segment forecast bar |
| `createTimeMarkers(divisions, width)` | `┃` at equal intervals | Visual ruler (5 divs for 5h, 7 for weekly) |

**Bar width calculation**: Snaps to multiples of 35 chars, clamped [35, 315], computed from `40% * terminal_width - overhead`.

**Prediction overlay**: Weekly metrics show a 3-color prediction bar when meaningful data exists:
- `▓` (dark) = actual usage so far
- `▒` (medium, yellow) = predicted additional usage
- `░` (light, cyan) = predicted spare capacity

#### 2. Sparkline Chart (`PaceChart.tsx`)

**File**: `packages/cli/src/tui/components/PaceChart.tsx`

A compact sparkline using the Unicode block element set:

```typescript
const SPARK_CHARS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
```

Downsamples time-series data to fit terminal width, normalizes to max value, maps each sample to one of 9 height levels. Single row of characters, one character per time bucket.

**Note**: `PaceChart` is defined and its data provider (`packages/core/src/storage/pace.ts`) is complete, but it is **NOT currently wired into any panel** in the active TUI. It exists as a ready-to-use component awaiting integration.

### Layout System

**File**: `packages/cli/src/tui/App.tsx`

OpenTUI provides **Yoga-powered flexbox layout**. The app uses:

```
<box flexDirection="column" width="100%" height="100%">   <- root
  <box flexDirection="row" flexGrow={1}>                    <- Claude row
    <box width="40%">ServicePanel</box>                     <- bars
    <box width="60%">StatsPanel</box>                       <- tabbed stats
  </box>
  <box flexDirection="row" flexGrow={1}>                    <- Codex row
    <box width="40%">ServicePanel</box>
    <box width="60%">StatsPanel</box>
  </box>
  <StatusBar />                                              <- fixed bottom
  <text />                                                   <- footer hints
</box>
```

### Theming

**File**: `packages/cli/src/tui/theme.ts`

Two themes (Catppuccin Mocha default, Monochrome). Colors are hex strings applied via OpenTUI's `fg`, `backgroundColor` props on `<text>` and `<box>` elements.

### Reactive Updates

- **30s tick signal**: Shared across all panels for time-progress bar updates
- **10s auto-refresh**: Fetches fresh metrics from API/PTY/cache chain
- **SolidJS fine-grained reactivity**: Only re-renders the specific `<text>` elements whose data changed, not the whole tree

## Technology Stack Summary

| Layer | Technology | Native? |
|-------|-----------|---------|
| UI Framework | SolidJS (compile-time reactivity) | No (JS) |
| TUI Framework | OpenTUI (`@opentui/solid` + `@opentui/core`) | **Zig core** via FFI |
| Layout Engine | Yoga (via OpenTUI's Zig core) | **Native** (C/Zig) |
| Runtime | Bun | **Native** (Zig-based) |
| Layout Calculation | Yoga 3.2.1 | **WASM** (emscripten C++) |
| Syntax Highlighting | tree-sitter 0.25.10 | **WASM** (used for Code/Markdown renderables only) |
| Chart Primitives | Unicode block characters (`▓▒░▁▂...█┃`) | N/A (text) |
| Data Layer | Pure TypeScript | No |

**You already have native performance where it matters.** OpenTUI's Zig core handles the hot path (layout calculation, terminal buffer diffing, ANSI output). Your TypeScript code only computes *what* to render (string concatenation of block chars), not *how* to render it.

## Do You Need to Move to Rust?

### Short Answer: **No.**

### Long Answer

#### What Rust (Ratatui) Would Give You

| Capability | Ratatui | Your Current Stack |
|-----------|---------|-------------------|
| Sub-ms frame rendering | Yes (Rust) | Yes (Zig core, dirty-rect) |
| Built-in chart widgets | Sparklines, bar charts, line charts, gauges | Hand-built from Unicode chars |
| Layout engine | Constraint-based (custom) | Yoga flexbox (battle-tested) |
| Immediate-mode rendering | Yes (redraw full frame each tick) | Retained-mode (SolidJS diff) |
| Memory safety | Compile-time (Rust) | Runtime (JS + Zig FFI) |
| Startup time | ~5ms cold | ~50-100ms (Bun + bundle) |

#### What You Would Lose

1. **SolidJS reactivity** - Your current fine-grained updates are *more efficient* than Ratatui's immediate mode for a dashboard that updates every 10-30s. Ratatui redraws everything every frame; SolidJS only touches changed text nodes.

2. **Development velocity** - TypeScript iteration speed vs Rust compile times. Your codebase is ~3k lines of TS; a Rust rewrite would be 2-5x that.

3. **OpenTUI ecosystem** - You'd lose the Zig-native layout engine, the SolidJS reconciler, theme support, and border rendering that you get for free.

4. **Bun FFI pipeline** - Your build system, test runner, and module resolution all depend on Bun. A Rust TUI would be a completely separate binary.

#### When Moving to Rust *Would* Make Sense

- If you needed **real-time charting at 60 FPS** with hundreds of data points updating per frame (you don't, your data updates every 10-30s)
- If you needed **sub-5ms cold start** for CLI-tool integration (your pre-bundled start is already fast enough)
- If you wanted **built-in chart widgets** without hand-coding Unicode (valid, but your current approach works and is maintainable)
- If you were shipping a **standalone binary** with zero runtime dependencies

#### What You Could Do Instead (Within Current Stack)

1. **Richer charts without Rust**: Build a `BarChart` component that wraps `createCapacityBar`/`createPredictionBar` with automatic color gradient support. OpenTUI's `<box>` with `backgroundColor` can create proper colored bar segments without block characters.

2. **Use OpenTUI's native rendering**: Instead of composing strings of `▓▒░`, you could use `<box>` elements with percentage widths and background colors for true "filled box" bars. This would give you smoother visual appearance and pixel-level precision.

3. **Line/area charts via braille**: The braille Unicode block (`U+2800-U+28FF`) gives you a 2x4 pixel grid per character. Libraries like `asciichart` use this for smooth line graphs. You could add trend lines to the prediction overlay.

4. **Sixel/Kitty graphics protocol**: If targeting modern terminals (iTerm2, Kitty, WezTerm), you can render actual bitmap graphics inline. OpenTUI may support this in future versions.

## Competitive Landscape: TUI Chart Libraries

| Library | Language | Chart Types | Rendering Model | Performance |
|---------|----------|------------|-----------------|-------------|
| **Ratatui** | Rust | Bar, line, sparkline, gauge, scatter | Immediate mode, double-buffered | Sub-ms, zero-cost |
| **OpenTUI** | TS + Zig | Primitives only (box/text), build your own | Retained mode, dirty-rect | 60 FPS via Zig core |
| **Ink** | JS (React) | None built-in, compose from text | Virtual DOM reconciler | Good, JS overhead |
| **Blessed** | JS | Some widgets | Custom rendering | Dated, unmaintained |
| **BubbleTea** | Go | Via Lipgloss/charting libs | Elm architecture | Good |
| **Textual** | Python | Rich widget set | CSS-like layout | Moderate |

## Key Takeaways

1. **Your rendering stack is already native where it counts.** OpenTUI's Zig core + Yoga layout + Bun's Zig runtime means your hot path is compiled native code. The TypeScript you write is just composing *what* to show, not *how* to paint it.

2. **Your chart approach (Unicode block chars in `<text>`) is simple, effective, and the standard pattern in terminal UIs.** Ratatui does the exact same thing internally, it just wraps it in widget abstractions. You could build similar abstractions in TypeScript without moving to Rust.

3. **The biggest improvement available without any technology change**: Replace string-of-block-chars bars with `<box>` elements that use `width` percentages and `backgroundColor`. This gives you true colored bar segments, smoother scaling, and eliminates the `calculateBarWidth` snapping. OpenTUI's flexbox handles the proportional sizing natively.

## Complete Data Pipeline

```
SQLite (usage_snapshots)
  └> UsageStore.getDailyBoundaries()
       └> computeDailyDeltas()          [core/prediction/deltas.ts]
            └> predict()                [core/prediction/project.ts]
                  └> CapacityPrediction
                        └> usePrediction hook   [cli/tui/hooks/usePrediction.ts]
                              └> ServicePanel / FullscreenMetricView
                                    └> createPredictionBar()  [core/utils/bars.ts]

API/PTY Providers (every 10s via useAutoRefresh)
  └> chain.refresh() / chain.start()
       └> updateMetrics()               [cli/tui/hooks/useMetrics.ts]
            └> claudeMetrics / codexMetrics signals [SolidJS]
                  └> ServicePanel.metricEntries() memo
                        ├> calculateBarWidth()      [core/utils/bars.ts]
                        ├> createCapacityBar()      [core/utils/bars.ts]
                        ├> createTimeMarkers()      [core/utils/bars.ts]
                        ├> calculateTimeProgress()  [core/utils/time.ts] (30s tick)
                        └> createPeriodBar()        [core/utils/bars.ts]

Ledger Worker subprocess (JSONL files, Bun.spawn)
  └> useLedgerData hook                 [cli/tui/hooks/useLedgerData.ts]
       └> StatsPanel > LedgerContent > DataTable  (text-only, no visual bars)

buildPaceData() [core/storage/pace.ts]
  └> PaceChart                          [cli/tui/components/PaceChart.tsx]
       └> NOT CURRENTLY WIRED INTO ANY PANEL
```

## Sources

- [OpenTUI GitHub](https://github.com/anomalyco/opentui)
- [OpenTUI Documentation](https://opentui.com/)
- [OpenTUI SolidJS Binding](https://opentui.com/docs/bindings/solid/)
- [OpenTUI Architecture - DeepWiki](https://deepwiki.com/sst/opentui)
- [Ratatui - Rust TUI](https://ratatui.rs/)
- [Ratatui GitHub](https://github.com/ratatui/ratatui)
- [OpenTUI Rust Port](https://github.com/Dicklesworthstone/opentui_rust)
- [TUI Framework Comparison - LogRocket](https://blog.logrocket.com/7-tui-libraries-interactive-terminal-apps/)
- [BubbleTea vs Ratatui](https://dev.to/rosgluk/terminal-ui-bubbletea-go-vs-ratatui-rust-2plj)
