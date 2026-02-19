/**
 * Left panel for one service showing full stacked progress bars for all metrics.
 * Each metric renders: label, capacity bar, time markers, period bar, reset time.
 */
import { For, Show, createMemo } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useTheme } from "../theme.js";
import {
  createCapacityBar,
  createTimeMarkers,
  createPeriodBar,
  calculateTimeProgress,
  calculateBarWidth,
  type MetricsDict,
  type MetricData,
} from "@lazyusage/core";

export const LABEL_MAP: Record<string, string> = {
  session: "Session (5h)",
  week_all: "Weekly (All)",
  week_sonnet: "Weekly (Sonnet)",
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
}

const BAR_OVERHEAD = 12;
const MIN_LOCAL_BAR = 20;

export function ServicePanel(props: ServicePanelProps) {
  const theme = useTheme();

  const panelTitle = () => {
    const sub = props.metrics?.subscription_type;
    const suffix = sub && typeof sub === "string" ? ` - ${sub}` : "";
    return ` [${props.panelNumber}] ${props.title}${suffix} `;
  };

  const metricEntries = createMemo(() => {
    if (!props.metrics) return [];
    const keys = METRIC_KEYS[props.service] ?? [];
    const entries: Array<{ key: string; label: string; data: MetricData }> = [];
    for (const key of keys) {
      const val = props.metrics![key];
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
  const barWidth = () => {
    const cols = dims().width;
    const panelCols = Math.floor(cols * 0.4) - 4;
    return Math.max(MIN_LOCAL_BAR, calculateBarWidth(panelCols, BAR_OVERHEAD));
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
      borderStyle={"rounded" as any}
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
                return `${marker()}${entry.label}  \u25c6 ${usedPct()}%  \u23f1 ${timePctR()}%`;
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
                  <text
                    content={`  ${capBar()} \u25c6 ${usedPct()}%`}
                    fg={theme.text}
                    height={1}
                  />
                </Show>
                {/* Time markers */}
                <Show when={showMarkers()}>
                  <text
                    content={`  ${markers()}`}
                    fg={theme.surface1}
                    dim={true}
                    height={1}
                  />
                </Show>
                {/* Period bar */}
                <Show when={showPeriodBar()}>
                  <text
                    content={`  ${perBar()} \u23f1 ${timePctR()}%`}
                    fg={theme.cyan}
                    dim={true}
                    height={1}
                  />
                </Show>
                {/* Reset time */}
                <Show when={showResetTime()}>
                  <text
                    content={`    Resets: ${entry.data.resets}`}
                    fg={theme.subtext}
                    height={1}
                  />
                </Show>
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
