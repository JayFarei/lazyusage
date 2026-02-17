/**
 * Left panel for one service showing full stacked progress bars for all metrics.
 * Each metric renders: label, capacity bar, time markers, period bar, reset time.
 */
import { For, Show, createSignal, onCleanup } from "solid-js";
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
} from "@usage-tui/core";

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
  claude: ["session", "week_all", "week_sonnet"],
  codex: ["5h", "weekly"],
};

interface ServicePanelProps {
  service: "claude" | "codex";
  title: string;
  metrics: MetricsDict | null;
  error: string | null;
  isActive: boolean;
  selectedIndex: number;
  panelNumber: number;
}

const BAR_OVERHEAD = 12;
const MIN_LOCAL_BAR = 20;

export function ServicePanel(props: ServicePanelProps) {
  const theme = useTheme();
  const [tick, setTick] = createSignal(0);
  const tickInterval = setInterval(() => setTick((t) => t + 1), 30_000);
  onCleanup(() => clearInterval(tickInterval));

  const panelTitle = () => {
    const sub = props.metrics?.subscription_type;
    const suffix = sub && typeof sub === "string" ? ` - ${sub}` : "";
    return ` [${props.panelNumber}] ${props.title}${suffix} `;
  };

  const metricEntries = () => {
    if (!props.metrics) return [];
    const keys = METRIC_KEYS[props.service] ?? [];
    const entries: Array<{ key: string; label: string; data: MetricData }> = [];
    for (const key of keys) {
      const val = props.metrics[key];
      if (val && typeof val === "object" && "used_pct" in val) {
        entries.push({
          key,
          label: LABEL_MAP[key] ?? key,
          data: val as MetricData,
        });
      }
    }
    return entries;
  };

  const dims = useTerminalDimensions();
  const barWidth = () => {
    const cols = dims().width;
    const panelCols = Math.floor(cols * 0.4) - 4;
    return Math.max(MIN_LOCAL_BAR, calculateBarWidth(panelCols, BAR_OVERHEAD));
  };

  return (
    <box
      flexDirection="column"
      width="100%"
      flexGrow={1}
      borderStyle={"rounded" as any}
      borderColor={theme.borderActive}
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
            const isSelected = () => idx() === props.selectedIndex;
            const w = barWidth();
            const windowHrs = WINDOW_HOURS[entry.key] ?? 5;
            const divisions = windowHrs === 168 ? 7 : 5;

            const capBar = () => createCapacityBar(entry.data.used_pct, w);
            const markers = () => createTimeMarkers(divisions, w);
            const timePct = () => { tick(); return calculateTimeProgress(entry.data.resets, windowHrs); };
            const perBar = () => createPeriodBar(timePct(), w);
            const usedPct = () => Math.round(entry.data.used_pct);
            const timePctR = () => Math.round(timePct());

            const marker = () => (isSelected() ? "\u25b8 " : "  ");

            return (
              <box flexDirection="column" width="100%" paddingLeft={1}>
                {/* Label */}
                <text
                  content={`${marker()}${entry.label}`}
                  fg={isSelected() ? theme.green : theme.cyan}
                  backgroundColor={isSelected() ? theme.selectionBg : undefined}
                  bold={true}
                  height={1}
                />
                {/* Capacity bar */}
                <text
                  content={`  ${capBar()} \u25c6 ${usedPct()}%`}
                  fg={theme.text}
                  height={1}
                />
                {/* Time markers */}
                <text
                  content={`  ${markers()}`}
                  fg={theme.surface1}
                  dim={true}
                  height={1}
                />
                {/* Period bar */}
                <text
                  content={`  ${perBar()} \u23f1 ${timePctR()}%`}
                  fg={theme.cyan}
                  dim={true}
                  height={1}
                />
                {/* Reset time */}
                <text
                  content={`    Resets: ${entry.data.resets}`}
                  fg={theme.subtext}
                  height={1}
                />
                {/* Spacer between metrics */}
                <text content="" height={1} />
              </box>
            );
          }}
        </For>
      </Show>
    </box>
  );
}
