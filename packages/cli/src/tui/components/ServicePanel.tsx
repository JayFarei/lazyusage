/**
 * Left panel for one service showing full stacked progress bars for all metrics.
 * Each metric renders: label, capacity bar, time markers, period bar, reset time.
 */

import { useTerminalDimensions } from "@opentui/solid";
import {
  type CapacityPrediction,
  calculateBarWidth,
  calculateTimeProgress,
  createCapacityBar,
  createPeriodBar,
  createPredictionBar,
  createTimeMarkers,
  formatTimeRemaining,
  type MetricData,
  type MetricsDict,
  parseTimeToDatetime,
} from "lazyusage-core";
import { createMemo, For, Show } from "solid-js";
import { ROUNDED_BORDER_STYLE } from "../lib/borderStyle.js";
import { useTheme } from "../theme.js";

export const LABEL_MAP: Record<string, string> = {
  session: "Session (5h)",
  week_all: "Weekly (All)",
  week_sonnet: "Weekly (Fable)",
  "5h": "Session (5h)",
  weekly: "Weekly",
};

export const WINDOW_HOURS: Record<string, number> = {
  session: 5,
  week_all: 168,
  week_sonnet: 168,
  "5h": 5,
  weekly: 168,
};

export const METRIC_KEYS: Record<string, string[]> = {
  claude: ["week_all", "week_sonnet", "session"],
  codex: ["weekly", "5h"],
};

interface ServicePanelProps {
  service: "claude" | "codex";
  title: string;
  metrics: MetricsDict | null;
  error: string | null;
  isActive: boolean;
  selectedIndex: number;
  panelNumber: number;
  panelCount?: number;
  /** Shared 30s tick from App, replaces per-panel setInterval */
  tick?: number;
  prediction?: Record<string, CapacityPrediction>;
}

const BAR_OVERHEAD = 12;
const MIN_LOCAL_BAR = 20;

export function ServicePanel(props: ServicePanelProps) {
  const theme = useTheme();

  const panelTitle = () => {
    const sub = props.metrics?.subscription_type;
    const suffix = sub && typeof sub === "string" ? ` - ${sub}` : "";
    const full = ` [${props.panelNumber}] ${props.title}${suffix} `;
    // OpenTUI drops a border title entirely when it does not fit, so degrade
    // gracefully: drop the subscription suffix first, then hard-truncate.
    const maxLen = panelCols();
    if (full.length <= maxLen) return full;
    const short = ` [${props.panelNumber}] ${props.title} `;
    return short.length <= maxLen ? short : short.slice(0, Math.max(0, maxLen));
  };

  const metricEntries = createMemo(() => {
    if (!props.metrics) return [];
    const keys = METRIC_KEYS[props.service] ?? [];
    const entries: Array<{ key: string; label: string; data: MetricData }> = [];
    for (const key of keys) {
      const val = props.metrics?.[key];
      if (val && typeof val === "object" && "used_pct" in val) {
        entries.push({
          key,
          label: LABEL_MAP[key] ?? key,
          data: val as MetricData,
        });
      }
    }
    return entries;
  });

  const dims = useTerminalDimensions();
  const panelCols = () => Math.floor(dims().width * 0.4) - 4;
  const barWidth = () => {
    const cols = panelCols();
    // Use non-prediction overhead (prefix "  " + " ◆ 14%" suffix ~= BAR_OVERHEAD)
    // Prediction suffix is handled separately by truncating to fit remaining space
    const maxBar = cols - BAR_OVERHEAD;
    if (maxBar < MIN_LOCAL_BAR) return Math.max(8, maxBar);
    return Math.min(maxBar, calculateBarWidth(cols, BAR_OVERHEAD));
  };
  /**
   * Responsive text tier based on available panel width.
   * - "full": plenty of room for decorators ("◆", "⏱", " used │ ")
   * - "compact": tighter spacing, shorter labels
   * - "minimal": bare minimum, just percentages
   */
  const textTier = (): "full" | "compact" | "minimal" => {
    const cols = panelCols();
    if (cols >= 38) return "full";
    if (cols >= 26) return "compact";
    return "minimal";
  };

  const panelHeight = () => {
    const h = dims().height;
    const panelCount = props.panelCount ?? 2;
    // 2 fixed rows: status bar + footer hints
    // each panel row has 2 border rows (top+bottom)
    return Math.floor((h - 2) / panelCount) - 2;
  };

  const renderMode = () => {
    const h = panelHeight();
    const n = metricEntries().length;
    if (n === 0 || h >= n * 6) return "full";
    return "focus"; // selected=full, others=1 line
  };

  return (
    <box
      flexDirection="column"
      width="100%"
      flexGrow={1}
      borderStyle={ROUNDED_BORDER_STYLE}
      borderColor={props.isActive ? theme.borderActive : theme.text}
      title={panelTitle()}
      titleAlignment="left"
    >
      <Show when={props.error}>
        <text content={`  Error: ${props.error}`} fg={theme.red} height={1} />
      </Show>

      <Show when={!props.metrics && !props.error}>
        <text content="  Loading..." fg={theme.subtext} height={1} />
      </Show>

      <Show when={props.metrics && !props.error}>
        <For each={metricEntries()}>
          {(entry, idx) => {
            // Inactive panels (selectedIndex === -1) default to first metric open
            const isSelected = () => {
              const si = props.selectedIndex;
              return idx() === (si === -1 ? 0 : si);
            };
            const mode = () => renderMode();
            const windowHrs = WINDOW_HOURS[entry.key] ?? 5;
            const divisions = windowHrs === 168 ? 7 : 5;

            // Memoized bar strings: recompute only when their specific dependencies change
            const capBar = createMemo(() => createCapacityBar(entry.data.used_pct, barWidth()));
            const markers = createMemo(() => createTimeMarkers(divisions, barWidth()));
            const timePct = createMemo(() => {
              void props.tick; // reactive dependency on shared 30s tick
              return calculateTimeProgress(entry.data.resets, windowHrs);
            });
            const perBar = createMemo(() => createPeriodBar(timePct(), barWidth()));
            const usedPct = () => Math.round(entry.data.used_pct);
            const timePctR = () => Math.round(timePct());

            const marker = () => (isSelected() ? "\u25b8 " : "  ");

            // Visibility per element: full=always, focus=only selected gets all rows
            const showCapBar = () => mode() === "full" || isSelected();
            const showMarkers = () => mode() === "full" || isSelected();
            const showPeriodBar = () => mode() === "full" || isSelected();
            const showResetTime = () => mode() === "full" || isSelected();
            const showSpacer = () => mode() === "full" || isSelected();

            const labelText = () => {
              const collapsed = mode() === "focus" && !isSelected();
              if (collapsed) {
                const pred = props.prediction?.[entry.key];
                const predMeaningful = pred && (pred.usedSoFar >= 5 || pred.remainingDays <= 5);
                const tier = textTier();
                let predSuffix = "";
                if (predMeaningful) {
                  if (tier === "minimal") {
                    predSuffix = pred.overBudget ? " OVER" : "";
                  } else if (tier === "compact") {
                    predSuffix = pred.overBudget ? " \u2192OVER" : ` \u2192${Math.round(pred.predictedSpare)}%`;
                  } else {
                    predSuffix = pred.overBudget ? " \u2192 OVER" : ` \u2192 ${Math.round(pred.predictedSpare)}% spare`;
                  }
                }
                if (tier === "minimal") {
                  return `${marker()}${entry.label} ${usedPct()}%${predSuffix}`;
                }
                const sep = tier === "full" ? "  " : " ";
                return `${marker()}${entry.label}${sep}\u25c6 ${usedPct()}%${sep}\u23f1 ${timePctR()}%${predSuffix}`;
              }
              return `${marker()}${entry.label}`;
            };

            return (
              <box flexDirection="column" width="100%" paddingLeft={1}>
                {/* Label - always shown; appends summary when collapsed */}
                <text
                  content={labelText()}
                  fg={isSelected() ? theme.green : theme.cyan}
                  dim={mode() === "focus" && !isSelected()}
                  backgroundColor={isSelected() ? theme.selectionBg : undefined}
                  bold={true}
                  height={1}
                />
                {/* Capacity bar */}
                <Show when={showCapBar()}>
                  {(() => {
                    const pred = props.prediction?.[entry.key];
                    // Show prediction bar for weekly metrics, but only when the prediction
                    // is meaningful. Skip when window just reset (< 5% used, > 5 days left),
                    // historic rates don't reflect the new window yet.
                    const predUseful = (pred && pred.usedSoFar >= 5) || (pred && pred.remainingDays <= 5);
                    if (
                      pred &&
                      predUseful &&
                      (entry.key === "week_all" || entry.key === "week_sonnet" || entry.key === "weekly")
                    ) {
                      const w = barWidth();
                      const predictedPct = Math.max(0, pred.projectedTotal - pred.usedSoFar);
                      const segments = createPredictionBar(entry.data.used_pct, predictedPct, w);
                      // Single string avoids flex-row alignment issues at narrow widths
                      const barStr = segments.used + segments.predicted + segments.spare;
                      const label =
                        textTier() === "full"
                          ? ` ${usedPct()}% used`
                          : textTier() === "compact"
                            ? ` ${usedPct()}%`
                            : "";
                      return <text content={`  ${barStr}${label}`} fg={theme.text} height={1} />;
                    }
                    return <text content={`  ${capBar()} \u25c6 ${usedPct()}%`} fg={theme.text} height={1} />;
                  })()}
                </Show>
                {/* Time markers */}
                <Show when={showMarkers()}>
                  <text content={`  ${markers()}`} fg={theme.surface1} dim={true} height={1} />
                </Show>
                {/* Period bar */}
                <Show when={showPeriodBar()}>
                  <text content={`  ${perBar()} \u23f1 ${timePctR()}%`} fg={theme.cyan} dim={true} height={1} />
                </Show>
                {/* Spacer above reset for visual breathing room */}
                <Show when={showResetTime()}>
                  <text content="" height={1} />
                </Show>
                {/* Reset time with countdown */}
                <Show when={showResetTime()}>
                  <text
                    content={(() => {
                      void props.tick;
                      const resetDate = parseTimeToDatetime(entry.data.resets);
                      const remaining = formatTimeRemaining(new Date(), resetDate, windowHrs);
                      return `  Resets: ${entry.data.resets} (${remaining})`;
                    })()}
                    fg={theme.subtext}
                    height={1}
                  />
                </Show>
                {/* Prediction summary (over/spare) below reset time */}
                {(() => {
                  if (!(mode() === "full" || isSelected())) return null;
                  const pred = props.prediction?.[entry.key];
                  const predUseful = pred && (pred.usedSoFar >= 5 || pred.remainingDays <= 5);
                  if (!pred || !predUseful) return null;
                  if (entry.key !== "week_all" && entry.key !== "week_sonnet" && entry.key !== "weekly") return null;
                  const sparePrefix = pred.confidence === "low" ? "~" : "";
                  const spareVal = `${sparePrefix}${Math.round(pred.predictedSpare)}%`;
                  const summary = pred.overBudget ? `  \u26a1 OVER BUDGET ${spareVal}` : `  \u26a1 ${spareVal} spare`;
                  return (
                    <text
                      content={summary}
                      fg={pred.overBudget ? theme.red : theme.subtext}
                      bold={pred.overBudget}
                      height={1}
                    />
                  );
                })()}
                {/* Spacer between metrics */}
                <Show when={showSpacer()}>
                  <text content="" height={1} />
                </Show>
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
