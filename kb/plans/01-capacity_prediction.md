# Predictive Capacity — v1

**Status:** Reviewed, ready for implementation
**Date:** 2026-03-25
**Reviewed by:** /autoplan (CEO + Design + Eng, dual voices: Codex + Claude subagent)

## Overview

Predictive capacity projects a user's weekly usage forward to estimate how much spare capacity will remain at the end of the current billing window. The primary purpose is **protecting the user**: answering "am I on pace to hit my limit before the window resets?" Secondary use is surfacing the prediction to downstream tools (agents, scripts) via `--predict --json`.

**Core idea:** if you are at 47% usage with 60% of the window elapsed, you are ahead of pace and have headroom. If you are at 80% with 40% elapsed, you are on track to hit the cap. The prediction engine uses recent daily consumption history to project forward, rather than relying solely on the instantaneous pace metric (`capacity_remaining`).

**Key distinction:**
- `capacity_remaining` (existing `--capacity`) = "am I ahead or behind pace *right now*?" (time_elapsed% - used%)
- `predicted_spare` (new `--predict`) = "how much total headroom will I have *at window end*?" (forward projection based on history)

### Design Principles

- **CLI-first.** Prediction works standalone via `--predict`. No daemon required.
- **Always offer something.** Even with zero history, provide a linear extrapolation from current usage. With history, improve accuracy.
- **Real-time is the circuit breaker.** If real-time `capacity_remaining` drops below `predicted_spare`, the real-time value takes precedence.
- **Opt-in display.** TUI prediction bar overlay activates when prediction data is available. CLI prediction requires the `--predict` flag.
- **Single-agent in v1.** Prediction is advisory. No reservation or claim system. Multi-agent coordination deferred to v2.


## Prediction Algorithm

### v1: Linear Extrapolation with Recent History

The v1 prediction uses a simple, robust approach: compute the user's average daily consumption rate from recent history, then project forward.

**Step 1: Extract daily deltas**

Query `UsageStore` for first and last snapshot per calendar day, grouped by metric:

```sql
SELECT
  date(timestamp) AS day,
  MIN(timestamp) AS first_ts,
  MAX(timestamp) AS last_ts,
  (SELECT used_pct FROM usage_snapshots s2
   WHERE s2.timestamp = MIN(s1.timestamp)
     AND s2.service = s1.service AND s2.metric_name = s1.metric_name) AS first_pct,
  (SELECT used_pct FROM usage_snapshots s2
   WHERE s2.timestamp = MAX(s1.timestamp)
     AND s2.service = s1.service AND s2.metric_name = s1.metric_name) AS last_pct,
  (SELECT resets_at FROM usage_snapshots s2
   WHERE s2.timestamp = MAX(s1.timestamp)
     AND s2.service = s1.service AND s2.metric_name = s1.metric_name) AS resets_at
FROM usage_snapshots s1
WHERE service = ? AND metric_name = ? AND timestamp >= ?
GROUP BY date(timestamp)
ORDER BY day
```

For each day: `delta = last_pct - first_pct`

**Step 2: Handle window resets (negative deltas)**

When `delta < 0`, a window reset occurred mid-day. Use the `resets_at` ISO timestamp to split:
```
pre_reset  = 100 - first_pct    // usage consumed before window rolled
post_reset = last_pct           // usage consumed in the new window
```

Days with >1 negative transition are skipped entirely (rare edge case: subscription tier change mid-day).

Days with only 1 snapshot have `delta = 0` and are treated as "unknown" (excluded from the average, not counted as zero).

**Step 3: Compute average daily rate**

```
average_rate = sum(valid_deltas) / count(valid_deltas)
```

This is a simple mean of recent daily deltas. The v1.1 regime engine will replace this with an exponential-decay weighted average for better recency bias.

**Cold start (0 valid days):** Use a conservative fixed rate of 15%/day and report `confidence: "low"`.

**Step 4: Project forward**

```
remaining_days = fractional days until window reset (from resets_at)
projected_total = used_so_far + (remaining_days * average_rate)
predicted_spare = max(0, 100 - projected_total)   // clamped for bar display
over_budget = projected_total > 100
```

**Prediction scope:** Per-metric for weekly metrics. Claude predicts both `week_all` AND `week_sonnet` independently (they are separate binding constraints). Codex predicts `weekly`. Session metrics are not predicted (too short a window).

**Confidence levels:**
- `low`: <7 days of valid history, or 0 valid days (using fixed rate)
- `medium`: 7-21 days
- `high`: 21+ days

### Partial Day Handling (Today)

For the current day, use actual usage so far plus pro-rated prediction for the remainder:

```
today_actual = current_used_pct - bod_used_pct
remaining_hours = 24 - hours_elapsed_today
today_predicted = average_rate * (remaining_hours / 24)
today_total = today_actual + today_predicted
```

Sub-day precision is intentionally approximate. Prediction accuracy degrades as `remaining_days` approaches zero, which is expected and acceptable.

### Over-Budget Prediction

When `projected_total > 100`, the prediction indicates the user will likely hit their cap:

```json
{
  "predicted_spare": -12,
  "over_budget": true,
  "confidence": "medium"
}
```

Text output: `Predicted spare at window end: OVER BUDGET -12% (medium confidence)`


## Supervised Marks

Users can mark upcoming days with expected usage levels to improve prediction accuracy.

### Regime Levels

| Level | Label | Rate (%/day) | Typical scenario |
|-------|-------|-------------|------------------|
| Low | `L` | 3% | Day off, meetings, travel |
| Medium | `M` | 9% | Normal work day |
| High | `H` | 15% | Heavy coding |
| Burst | `B` | 25% | Deadline push |

These are fixed rates in v1. The v1.1 regime engine will derive personalized rates from the user's own quartile distribution.

### CLI Interface

```bash
# Set a mark
lazyusage plan 2026-03-26 H
# Output: Marked 2026-03-26 as High (15%/day)

# Set multiple marks
lazyusage plan 2026-03-27 L 2026-03-28 M

# List current marks
lazyusage plan list
# Output:
# 2026-03-26  H  (High, 15%/day)
# 2026-03-28  M  (Medium, 9%/day)

# Clear a mark
lazyusage plan clear 2026-03-26
# Output: Cleared mark for 2026-03-26

# Clear all marks
lazyusage plan clear --all
```

**Validation rules:**
- Date must be `YYYY-MM-DD` format
- Regime must be exactly `L`, `M`, `H`, or `B` (case-insensitive, stored uppercase)
- Date must not be in the past
- Date must be within 14 days from today
- Invalid input returns non-zero exit code with error message

### Override Behavior

For any day the user has marked, the mark's fixed rate replaces the computed average rate for that day's projection. Unmarked days use the computed average. When both supervised and unsupervised exist, `source` is reported as `"blended"`.

### Persistence

Supervised marks are stored in a `capacity_marks` table in the existing SQLite database (`usage.db`):

```sql
CREATE TABLE IF NOT EXISTS capacity_marks (
  date TEXT PRIMARY KEY,          -- YYYY-MM-DD
  regime TEXT NOT NULL CHECK (regime IN ('L', 'M', 'H', 'B')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

**Advantages over a separate JSON file:** crash-safe (WAL mode), no concurrent write issues, single persistence layer, inherits existing chmod 0o600 on `usage.db`.

Marks for dates in the past are ignored during projection. Old marks (>7 days behind today) are cleaned up automatically during `cleanupOldSnapshots()`.


## Data Model

### Types (packages/core)

```typescript
type Regime = "L" | "M" | "H" | "B";

/** Fixed daily rates for each regime level (v1) */
const REGIME_RATES: Record<Regime, number> = {
  L: 3, M: 9, H: 15, B: 25,
};

interface DailyDelta {
  date: string;       // YYYY-MM-DD
  delta: number;      // % of weekly allowance consumed that day
  valid: boolean;     // false if single-sample or multi-reset day
}

interface DailyBoundary {
  date: string;       // YYYY-MM-DD
  firstUsedPct: number;
  lastUsedPct: number;
  resetsAt: string | null; // ISO timestamp from resets_at column
  sampleCount: number;
}

interface CapacityPrediction {
  service: string;
  metricName: string;    // "week_all", "week_sonnet", or "weekly"
  usedSoFar: number;
  remainingDays: number; // fractional
  averageRate: number;   // daily consumption rate used for projection
  projectedTotal: number;
  predictedSpare: number; // can be negative
  overBudget: boolean;
  source: "unsupervised" | "supervised" | "blended";
  confidence: "low" | "medium" | "high";
  sampleDays: number;
  windowEnds: string;    // ISO timestamp
}

interface SupervisedMark {
  date: string;   // YYYY-MM-DD
  regime: Regime;
}
```

### Prediction State Machine

The prediction overlay in the TUI follows this state machine:

```
UNAVAILABLE ──(history query completes)──> CALCULATING
CALCULATING ──(projection computed)──────> READY (low | medium | high confidence)
READY ────────(snapshot >5min old)────────> STALE
READY ────────(exception in engine)───────> ERROR
STALE ────────(fresh snapshot arrives)────> READY
ERROR ────────(retry on next tick)────────> CALCULATING
```

- **UNAVAILABLE**: TUI renders standard 2-segment bar, no prediction
- **CALCULATING**: TUI renders standard 2-segment bar (prediction not yet ready)
- **READY**: TUI renders 3-segment bar with prediction overlay
- **STALE**: TUI renders 3-segment bar with dimmed prediction segment
- **ERROR**: TUI renders standard 2-segment bar (silent fallback)

### Existing Infrastructure

| Component | Location | How it is used |
|-----------|----------|----------------|
| `UsageStore` | `packages/core/src/storage/database.ts` | **ADD:** `getDailyBoundaries()` method (new SQL query) |
| `calculateTimeProgress()` | `packages/core/src/utils/time.ts` | Reuse for `remainingDays` calculation |
| `WEEKLY_WINDOW_HOURS` | `packages/core/src/constants.ts` | Window duration constant |
| `createCapacityBar()` | `packages/core/src/utils/bars.ts` | **KEEP INTACT.** New `createPredictionBar()` alongside |
| `formatCombinedJson()` | `packages/core/src/formatters/json.ts` | **ADD:** optional `prediction` block in existing envelope |
| `formatClaudeCapacityText()` | `packages/core/src/formatters/text.ts` | **ADD:** prediction suffix |

**NOT reused:**
- `buildPaceData()` — computes hourly averages of cumulative percentages. Prediction needs first/last per day, not averages.
- `getHistory()` — returns `{timestamp, used_pct}` only, missing `resets_at`. New `getDailyBoundaries()` replaces this for prediction.


## CLI Output

### `--predict` flag

Prediction requires an explicit `--predict` flag. Existing output is unchanged without it.

**Flag compatibility matrix:**

| Combination | Behavior |
|-------------|----------|
| `--predict` | Text prediction line (same as `--predict --text`) |
| `--predict --text` | Text prediction line |
| `--predict --json` | Adds `prediction` block to existing JSON envelope |
| `--predict --capacity` | Capacity line + prediction line |
| `--predict --capacity --json` | Capacity JSON + prediction block |
| `--predict --json --live` | NDJSON stream with prediction block in each line |
| `--predict --serve` | **Error:** mutually exclusive (deferred to v2 daemon) |

**Text output (`--predict`):**
```
Predicted spare at window end: +30% (medium confidence, 25 days history)
```

**Text output (`--predict --capacity`):**
```
Session: +25% | Weekly: +18% | Sonnet: +22% | Predicted: +30% spare [Subscription: max]
```

**Text output (over-budget):**
```
Predicted spare at window end: OVER BUDGET -12% (medium confidence, 25 days history)
```

**JSON output (`--predict --json`):**

Adds a `prediction` key to each service in the existing `services[]` envelope:

```json
{
  "timestamp": "2026-03-25T14:30:00Z",
  "available_services": ["claude", "codex"],
  "services": [
    {
      "name": "claude",
      "available": true,
      "source": "pty",
      "metrics": [ ... ],
      "prediction": {
        "week_all": {
          "predicted_spare": 30,
          "over_budget": false,
          "projected_total": 70,
          "average_rate": 7.8,
          "remaining_days": 2.3,
          "used_so_far": 47,
          "source": "blended",
          "confidence": "medium",
          "sample_days": 25,
          "window_ends": "2026-03-27T16:00:00Z"
        },
        "week_sonnet": {
          "predicted_spare": 45,
          "over_budget": false,
          "projected_total": 55,
          "average_rate": 5.2,
          "remaining_days": 2.3,
          "used_so_far": 33,
          "source": "unsupervised",
          "confidence": "medium",
          "sample_days": 25,
          "window_ends": "2026-03-27T16:00:00Z"
        }
      }
    }
  ]
}
```

Tools that do not understand `prediction` ignore it. The existing `metrics[]` array is unchanged.


## TUI Design

### Prediction Bar Overlay

The prediction extends the existing Weekly capacity bar from 2 segments to 3:

```
Without prediction (current):
  Weekly (All)
  ▓▓▓▓▓▓▓░░░░░░░░ ◆ 47%

With prediction overlay:
  Weekly (All)
  ▓▓▓▓▓▓▓▒▒▒▒░░░░ 47% used │ 30% spare
```

Three segments:
- **Dark (▓):** actual usage so far (`theme.text`) — same as current
- **Medium (▒):** predicted additional usage by window end (`theme.yellow`)
- **Cyan (░):** predicted spare at window end (`theme.cyan`)

**Over-budget rendering:**
```
  Weekly (All)
  ▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒ 85% used │ OVER BUDGET -12%
```
The `OVER BUDGET` text renders in `theme.red` bold. The bar fills completely (used + predicted = barWidth, spare = 0).

### Rendering Implementation

The 3-segment bar **cannot** be a single `<text>` element (each segment needs its own `fg` color). Implementation uses 3 adjacent `<text>` elements in a `<box flexDirection="row">`:

```tsx
<box flexDirection="row">
  <text content={usedSegment} fg={theme.text} />
  <text content={predictedSegment} fg={theme.yellow} />
  <text content={spareSegment} fg={theme.cyan} />
  <text content={` ${usedPct}% used │ ${spare}% spare`} fg={theme.subtext} />
</box>
```

A new function `createPredictionBar()` returns the three segment strings:

```typescript
interface PredictionBarSegments {
  used: string;       // ▓ characters
  predicted: string;  // ▒ characters
  spare: string;      // ░ characters
}

function createPredictionBar(
  usedPct: number,
  predictedPct: number,
  barWidth: number,
): PredictionBarSegments {
  const filled = Math.round((usedPct / 100) * barWidth);
  const predicted = Math.round((predictedPct / 100) * barWidth);
  const spare = barWidth - filled - predicted;  // remainder, never rounded independently
  return {
    used: "▓".repeat(Math.max(0, filled)),
    predicted: "▒".repeat(Math.max(0, Math.min(predicted, barWidth - filled))),
    spare: "░".repeat(Math.max(0, spare)),
  };
}
```

The existing `createCapacityBar()` is kept intact. Non-weekly metrics and non-prediction contexts continue to use it.

### Compact / Collapsed Mode

When the panel switches to collapsed mode (small terminal), prediction degrades to a suffix:

```
  ▸ Weekly (All)  ◆ 47%  ⏱ 60%  → 30% spare
```

If over-budget in collapsed mode:
```
  ▸ Weekly (All)  ◆ 85%  ⏱ 40%  → OVER BUDGET
```

### Confidence Display

| Confidence | Visual treatment |
|------------|-----------------|
| `low` | Predicted segment rendered dim, spare shows `~30% spare` (tilde prefix) |
| `medium` | Normal rendering |
| `high` | Normal rendering |

### State Transitions

- **No prediction data yet**: standard 2-segment bar (existing behavior)
- **Prediction ready**: 3-segment bar with labels
- **Prediction stale (>5min)**: 3-segment bar with dim predicted segment
- **Prediction error**: silent fallback to 2-segment bar
- **Over-budget**: full bar with red OVER BUDGET text

### Data Flow into ServicePanel

Add an optional `prediction` prop to `ServicePanelProps`:

```typescript
interface ServicePanelProps {
  // ... existing props ...
  prediction?: Record<string, CapacityPrediction>; // keyed by metric name
}
```

Rendering logic: if `prediction[entry.key]` exists AND the metric is a weekly metric (`week_all`, `week_sonnet`, `weekly`), render `createPredictionBar()`. Otherwise render `createCapacityBar()`.

A new hook `usePrediction()` computes prediction state from `UsageStore` on each tick (30s interval, matching existing refresh). Returns `Record<string, CapacityPrediction> | null`.


## Implementation Plan

### Step 1: Data Layer (packages/core)

**File: `packages/core/src/storage/database.ts`**

Add `getDailyBoundaries()` method to `UsageStore`:

```typescript
getDailyBoundaries(
  service: ServiceName,
  metricName: string,
  days: number = 30,
): DailyBoundary[] {
  // SQL query for first/last used_pct per day with resets_at
  // Returns array of {date, firstUsedPct, lastUsedPct, resetsAt, sampleCount}
}
```

Add `capacity_marks` table creation to `initDatabase()`.

Add mark CRUD methods:
```typescript
setCapacityMark(date: string, regime: Regime): void
getCapacityMarks(): SupervisedMark[]
clearCapacityMark(date: string): void
clearAllCapacityMarks(): void
```

Clean up old marks in `cleanupOldSnapshots()`.

### Step 2: Prediction Engine (packages/core)

**New directory: `packages/core/src/prediction/`**

| File | Exports | Purpose |
|------|---------|---------|
| `deltas.ts` | `computeDailyDeltas(boundaries: DailyBoundary[]): DailyDelta[]` | Process raw boundaries into valid daily deltas, handling resets |
| `project.ts` | `predict(deltas, usedSoFar, remainingDays, marks?): CapacityPrediction` | Linear extrapolation projection with optional supervised overrides |
| `index.ts` | barrel export | Re-export all prediction types and functions |

`deltas.ts`:
- Takes `DailyBoundary[]` from `getDailyBoundaries()`
- For each day: `delta = lastUsedPct - firstUsedPct`
- If `delta < 0`: split using `resetsAt`. If >1 negative transition in a day, mark invalid.
- If `sampleCount === 1`: mark invalid (unknown, not zero)
- Returns `DailyDelta[]` with `valid` flag

`project.ts`:
- Filters to valid deltas only
- Computes `averageRate = mean(valid deltas)`
- If 0 valid deltas: use cold-start rate (15%/day), confidence = "low"
- For each marked day in the remaining window: substitute the mark's fixed rate
- `projectedTotal = usedSoFar + sum(rate_per_remaining_day)`
- Returns `CapacityPrediction`

### Step 3: Formatters (packages/core)

**File: `packages/core/src/formatters/text.ts`**

Add `formatPredictionText(prediction: CapacityPrediction): string`

**File: `packages/core/src/formatters/json.ts`**

Modify `formatCombinedJson()` and `formatCombinedCapacityJson()` to accept an optional `predictions` parameter. When present, add a `prediction` key to the relevant service object in the output.

### Step 4: Bar Rendering (packages/core)

**File: `packages/core/src/utils/bars.ts`**

Add `createPredictionBar(usedPct, predictedPct, barWidth): PredictionBarSegments`

Keep `createCapacityBar()` unchanged.

### Step 5: CLI --predict flag (packages/cli)

**File: `packages/cli/src/commands/usage.ts`**

- Add `--predict` option to the Commander definition
- Add validation: `--predict --serve` is an error
- In each output branch (text, json, capacity, live), if `--predict` is set:
  1. Open `UsageStore`
  2. Call `getDailyBoundaries()` for each weekly metric
  3. Call `computeDailyDeltas()` then `predict()`
  4. Include prediction in output

### Step 6: CLI plan command (packages/cli)

**New file: `packages/cli/src/commands/plan.ts`**

Commander subcommand `plan` with three actions:
- `plan <date> <regime> [<date> <regime> ...]` — set marks
- `plan list` — show current marks
- `plan clear <date>` or `plan clear --all` — remove marks

Validation: YYYY-MM-DD format, L/M/H/B only, not past, max 14 days forward.

### Step 7: TUI Integration (packages/cli)

**New file: `packages/cli/src/tui/hooks/usePrediction.ts`**

Hook that:
1. On mount + each 30s tick, queries `getDailyBoundaries()` and runs `predict()` for each weekly metric
2. Returns `Record<string, CapacityPrediction> | null`
3. Catches exceptions silently (returns null on error = fallback to 2-segment bar)

**Modified file: `packages/cli/src/tui/components/ServicePanel.tsx`**

- Add `prediction` prop
- For weekly metrics with prediction data: render 3 `<text>` elements via `createPredictionBar()`
- For all other metrics or no prediction: render existing `createCapacityBar()`
- In collapsed mode: append `→ N% spare` or `→ OVER BUDGET` suffix

**Modified file: `packages/cli/src/tui/components/FullscreenMetricView.tsx`**

- Same prediction bar logic as ServicePanel for weekly metrics


## Test Plan

### Unit Tests — Prediction Engine

| ID | File | Test | Covers |
|----|------|------|--------|
| D1 | `tests/core/prediction-deltas.test.ts` | Normal day delta: BOD=30%, EOD=45% → delta=15% | Happy path |
| D2 | | Reset day: BOD=80%, EOD=16%, resets_at present → pre=20%, post=16% | Window reset split |
| D3 | | Single-sample day → marked invalid | Sparse data |
| D4 | | Missing day → excluded from results | Gaps |
| D5 | | Day with >1 negative transition → skipped | Multi-reset edge case |
| D6 | | Empty input → empty array | Zero data |
| D7 | | 30-day fixture from feasibility data → matches documented deltas | Integration with real data |
| P1 | `tests/core/prediction-project.test.ts` | Linear projection: used=47%, 2.3 days, rate=7.8 → spare=35% | Happy path |
| P2 | | Over-budget: used=85%, 3 days, rate=10 → spare=-15%, overBudget=true | Over-budget |
| P3 | | Zero remaining days → spare = 100 - usedSoFar | Window about to reset |
| P4 | | Zero valid deltas → cold-start (rate=15%, confidence=low) | Cold start |
| P5 | | All equal deltas → rate equals that delta | Uniform usage |
| P6 | | Supervised mark override: mark=L for day, unsupervised=H → uses L rate | Blended source |
| P7 | | Mixed marks + unsupervised → source="blended" | Blended detection |
| P8 | | 5 valid days → confidence=low, 15 days → medium, 25 → high | Confidence thresholds |

### Unit Tests — Data Layer

| ID | File | Test | Covers |
|----|------|------|--------|
| S1 | `tests/core/database.test.ts` | `getDailyBoundaries()` returns first/last/resetsAt per day | New query method |
| S2 | | Sparse data: only rows for days with snapshots | Missing days |
| S3 | | Metric filtering: week_all vs week_sonnet returns different rows | Per-metric |
| S4 | | `setCapacityMark()` + `getCapacityMarks()` roundtrip | Mark CRUD |
| S5 | | `clearCapacityMark()` removes specific mark | Clear single |
| S6 | | `clearAllCapacityMarks()` removes all | Clear all |
| S7 | | Old marks cleaned up in `cleanupOldSnapshots()` | Auto-cleanup |

### Unit Tests — Bar Rendering

| ID | File | Test | Covers |
|----|------|------|--------|
| B1 | `tests/core/bars.test.ts` | Normal 3-segment: used=47%, predicted=23%, width=35 → sum=35 | Happy path |
| B2 | | All used (100%) → full dark, no prediction/spare | Edge: full |
| B3 | | Nothing used (0%) → no dark, some predicted, rest spare | Edge: empty |
| B4 | | Over-budget: used+predicted > 100 → spare segment = 0 | Over-budget clamping |
| B5 | | Rounding: used=33.3%, predicted=33.3%, width=35 → total always = barWidth | Rounding alignment |
| B6 | | MIN_BAR_WIDTH edge cases → no negative segment lengths | Minimum width |
| B7 | | `createCapacityBar()` unchanged → existing tests still pass | Non-regression |

### Unit Tests — Formatters

| ID | File | Test | Covers |
|----|------|------|--------|
| T1 | `tests/core/formatters-text.test.ts` | Prediction text: spare=30%, confidence=medium → expected string | Text format |
| T2 | | Over-budget text: spare=-12% → "OVER BUDGET -12%" | Over-budget text |
| J1 | `tests/core/formatters-json.test.ts` | `--predict --json`: prediction block inside existing services[] | JSON additive |
| J2 | | `--capacity --json --predict`: both blocks present | Combined output |
| J3 | | No prediction data: prediction key absent from output | Graceful absence |

### CLI Tests

| ID | File | Test | Covers |
|----|------|------|--------|
| C1 | `tests/cli/plan.test.ts` | `plan 2026-03-26 H` → mark stored, confirmation | Set mark |
| C2 | | `plan list` → table output | List marks |
| C3 | | `plan clear 2026-03-26` → mark removed | Clear mark |
| C4 | | `plan yesterday H` → error, exit code 1 | Past date validation |
| C5 | | `plan 2026-03-26 X` → error, exit code 1 | Invalid regime |
| C6 | | `plan 2026-04-15 H` → error: >14 days | Future limit |
| F1 | `tests/cli/predict-flag.test.ts` | `--predict` alone → text output | Standalone |
| F2 | | `--predict --json` → valid JSON with prediction | JSON mode |
| F3 | | `--predict --serve` → error | Mutual exclusion |
| F4 | | `--predict --json --live` → NDJSON with prediction | Stream mode |

### TUI Snapshot Tests

| ID | File | Test | Covers |
|----|------|------|--------|
| U1 | `tests/tui/components/ServicePanel.test.tsx` | With prediction → 3-segment bar rendered | Prediction display |
| U2 | | Without prediction → standard 2-segment bar | Fallback |
| U3 | | Over-budget → red OVER BUDGET indicator | Over-budget state |
| U4 | | Collapsed mode → prediction suffix | Compact degradation |
| U5 | | Low confidence → dim segment + tilde prefix | Confidence display |

### E2E Tests

| ID | File | Test | Covers |
|----|------|------|--------|
| E1 | `packages/e2e/` | `--predict` text output matches expected format | CLI integration |
| E2 | | `--predict --json` output is valid JSON with prediction block | JSON integration |
| E3 | | TUI shows prediction bar when history exists | TUI integration |
| E4 | | TUI degrades to 2-segment when no history | Fallback integration |

### Coverage Targets

- `prediction/deltas.ts`: 100%
- `prediction/project.ts`: 100%
- `bars.ts` `createPredictionBar()`: 100%
- `commands/plan.ts`: 100%
- `--predict` flag routing: all valid + invalid combinations


## Architecture

```
packages/core/src/
├── prediction/              ← NEW
│   ├── deltas.ts            ← computeDailyDeltas()
│   ├── project.ts           ← predict()
│   └── index.ts             ← barrel export
├── storage/
│   ├── database.ts          ← ADD: getDailyBoundaries(), capacity_marks table, mark CRUD
│   └── pace.ts              ← UNCHANGED
├── formatters/
│   ├── text.ts              ← ADD: formatPredictionText()
│   └── json.ts              ← ADD: prediction block to existing envelope
├── utils/
│   ├── bars.ts              ← ADD: createPredictionBar()
│   └── time.ts              ← UNCHANGED
├── constants.ts             ← ADD: REGIME_RATES, COLD_START_RATE
└── types.ts                 ← ADD: CapacityPrediction, DailyDelta, DailyBoundary, etc.

packages/cli/src/
├── commands/
│   ├── usage.ts             ← ADD: --predict flag handling
│   └── plan.ts              ← NEW: lazyusage plan subcommand
├── tui/
│   ├── components/
│   │   ├── ServicePanel.tsx  ← MODIFY: conditional 3-segment bar
│   │   └── FullscreenMetricView.tsx ← MODIFY: prediction bar support
│   └── hooks/
│       └── usePrediction.ts  ← NEW: reactive prediction state
└── cli.ts                   ← ADD: register plan subcommand
```

### Key Coupling Points

1. `prediction/deltas.ts` depends on `getDailyBoundaries()` (new method, not existing `getHistory()`)
2. `ServicePanel.tsx` conditionally renders 3 `<text>` elements when `prediction` prop is present
3. `--predict` flag adds `prediction` block to existing JSON envelope (not a new schema)
4. `usePrediction.ts` hook depends on `UsageStore` and prediction engine, runs on 30s tick


## Future Work (v1.1 / v2)

The following items are deferred from v1. See `TODOS.md` for the full backlog.

### v1.1: Regime Engine

Replace the simple average rate with a quartile-based regime engine:
- Four regimes (L/M/H/B) derived from the user's own distribution
- Exponential-decay weighted average for "expected" scenario
- Four-scenario projection (optimistic/expected/conservative/worst)
- Personalized regime rates replace fixed rates in supervised marks

### v1.1: Calendar TUI

Fullscreen overlay for visual supervised mark management:
- 2-week grid with day cells
- Arrow key navigation, Enter/Space to cycle regime
- Live prediction update as marks change
- Keybinding: `c` (not `p`, which is already togglePause)

### v2: Daemon

Always-on background collector service:
- Continuous 60s collection loop
- HTTP API for prediction queries
- launchd (macOS) / systemd (Linux) process management

### v2: Multi-Agent Coordination

Reservation/lease system for safe multi-agent capacity consumption:
- Claim/release semantics in SQLite
- Admission control endpoint
- Per-agent budget tracking


<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|
| 1 | CEO | Reframe primary consumer from agents to user (pacing guard) | P1 Completeness | Both voices converge: larger audience, survives billing changes | "Offer spare to agents" as primary |
| 2 | CEO | Ship linear extrapolation before regime engine | P5 Explicit | Simpler, validates demand, 1 day CC vs 3-4 days | Full regime engine in v1 |
| 3 | CEO | Defer calendar TUI to v1.1 | P3 Pragmatic | CLI plan marks validate supervised mode with zero UI complexity | Full calendar overlay in v1 |
| 4 | CEO | Defer daemon to v2+ | P3 Pragmatic | Cron achieves 90% value, daemon is maintenance trap | Daemon in v1 |
| 5 | CEO | Document multi-agent as single-agent only in v1 | P5 Explicit | No reservation system, race condition is real | Hand-wave race condition |
| 6 | CEO | Reassign calendar keybinding from `p` to `c` | P5 Explicit | `p` = togglePause, conflict | Reuse `p` for calendar |
| 7 | CEO | Mode: SELECTIVE EXPANSION | P1+P2 | Hold prediction scope, expand to CLI plan marks | HOLD SCOPE or SCOPE EXPANSION |
| 8 | Design | Show 2 numbers (used + spare), drop middle predicted number | P5 Explicit | Middle number is derivable from bar visual, 3 unlabeled numbers unreadable | Triple unlabeled numbers |
| 9 | Design | Add micro-labels to bar numbers: `47% used │ 30% spare` | P5 Explicit | Bare numbers require memorization | Unlabeled numbers |
| 10 | Design | Specify prediction state machine: unavailable→calculating→ready→stale→error | P1 Completeness | Both voices: interaction states unspecified | Leave to implementer |
| 11 | Design | 3-segment bar uses 3 separate `<text>` elements, not embedded ANSI | P5 Explicit | OpenTUI `<text>` supports per-element `fg`, ANSI in strings may break | Single text with ANSI codes |
| 12 | Design | New function `createPredictionBar()` returning segment tuple, keep `createCapacityBar()` intact | P4 DRY | Non-breaking change, existing callers unaffected | Modify existing function signature |
| 13 | Design | In collapsed/compact mode, prediction shows as suffix: `◆ 47% → 30% spare` | P3 Pragmatic | Panel already switches to 1-line collapsed, prediction must degrade | Omit prediction in compact |
| 14 | Design | `--predict` text output labels semantic difference from `--capacity` | P5 Explicit | `capacity_remaining` = pacing now, `predicted_spare` = forecast at window end | Leave unlabeled |
| 15 | Design | Define CLI plan marks grammar: `lazyusage plan <date> <L/M/H/B>`, `plan list`, `plan clear` | P1 Completeness | Both voices: CLI plan marks have no command grammar | Defer grammar to implementer |
| 16 | Eng | Add `getDailyBoundaries()` to UsageStore instead of reusing `getHistory()` | P5 Explicit | `getHistory()` lacks `resets_at`, `buildPaceData()` gives averages not deltas | Modify getHistory() |
| 17 | Eng | Use `resets_at` ISO timestamps, never re-parse human `resets` string | P5 Explicit | `parseTimeToDatetime()` heuristics break on historical data | Re-parse resets |
| 18 | Eng | Guard for 0 sample days: return cold-start defaults | P1 Completeness | Division by zero in weighted average | Skip zero-guard |
| 19 | Eng | Predict both `week_all` AND `week_sonnet` for Claude | P1 Completeness | `week_sonnet` is a separate binding constraint | Predict week_all only |
| 20 | Eng | `--predict --json` adds prediction block to existing envelope, not new schema | P4 DRY | Breaking output contract for machine consumers | New top-level schema |
| 21 | Eng | Store supervised marks in SQLite table, not JSON file | P3 Pragmatic | Crash safety, no concurrent write issues, single persistence layer | JSON file |
| 22 | Eng | Third bar segment = `barWidth - filled - predicted` (never round independently) | P5 Explicit | Three independent rounds can misalign total | Round each independently |
| 23 | Eng | `--predict` flag combination matrix: compatible with --json, --text, --capacity, --live; error with --serve | P1 Completeness | Undefined flag interactions | Leave to implementer |
| 24 | Eng | Validate CLI plan args: YYYY-MM-DD format, L/M/H/B only, max 14 days forward, reject past dates | P1 Completeness | Garbage input produces garbage predictions | No validation |
| 25 | Eng | Apply chmod 0o600 on plan data write (whether SQLite table or file) | P1 Completeness | Match existing security posture | No file permissions |
| 26 | Eng | Doc needs rewrite: single right-sized v1 spec, body must match audit trail | P5 Explicit | Both eng voices: two incompatible v1s in same doc | Leave doc as-is |


## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAN | 6/6 consensus confirmed, 2 critical (framing, platform risk), 6 high |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAN | 7/7 consensus confirmed, 3 critical, 5 high, 4 medium |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | CLEAN | 4/6 issues, 2/6 OK; 1 critical (data layer), 3 high |
| CEO Voices | `autoplan` | Independent 2nd opinions | 1 | codex+subagent | 6/6 confirmed, 0 disagree |
| Design Voices | `autoplan` | Independent 2nd opinions | 1 | codex+subagent | 7/7 confirmed, 0 disagree |
| Eng Voices | `autoplan` | Independent 2nd opinions | 1 | codex+subagent | 4/6 confirmed, 2/6 OK |

**VERDICT:** APPROVED — 26 auto-decisions, 0 taste decisions, all consensus tables unanimous. Doc rewritten to match narrowed v1 scope.


## Appendix: Data Feasibility (Reference)

Analysis of a real `UsageStore` database (74,453 snapshots across 30 days) confirmed that daily delta extraction with window-reset splitting is feasible.

Key observations:
1. Daily deltas range from 0-51%, clustering into recognizable patterns
2. Window resets produce negative deltas, detectable via `resets_at`
3. Some days have sparse or missing data (TUI not open)
4. 30 days provides ~4 complete weekly cycles, sufficient for medium confidence
