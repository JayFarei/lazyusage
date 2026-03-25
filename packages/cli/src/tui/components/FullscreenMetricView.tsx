/**
 * Maximum-mode overlay for a service: shows ALL metrics with full bars.
 * Triggered by `g` when focused on the service panel.
 */
import { For, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useTheme } from "../theme.js";
import {
  createCapacityBar,
  createPredictionBar,
  createTimeMarkers,
  createPeriodBar,
  calculateTimeProgress,
  calculateBarWidth,
  type MetricsDict,
  type MetricData,
  type CapacityPrediction,
} from "@lazyusage/core";
import { LABEL_MAP, WINDOW_HOURS, METRIC_KEYS } from "./ServicePanel.js";

const BAR_OVERHEAD = 12;
const MIN_LOCAL_BAR = 20;

interface FullscreenMetricViewProps {
  service: "claude" | "codex";
  metricKey: string;
  metrics: MetricsDict | null;
  tick?: number;
  prediction?: Record<string, CapacityPrediction>;
}

export function FullscreenMetricView(props: FullscreenMetricViewProps) {
  const theme = useTheme();
  const dims = useTerminalDimensions();
  const tick = () => props.tick ?? 0;

  const barWidth = () => {
    const cols = dims().width;
    return Math.max(MIN_LOCAL_BAR, calculateBarWidth(cols - 8, BAR_OVERHEAD));
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

  const title = () => ` \u26f6 ${props.service} \u2014 all metrics (maximum) `;

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      flexDirection="column"
      borderStyle={"rounded" as any}
      borderColor={theme.cyan}
      title={title()}
      titleAlignment="left"
      backgroundColor={theme.base}
    >
      <Show when={!props.metrics}>
        <text content="  Loading..." fg={theme.subtext} height={1} />
      </Show>

      <For each={metricEntries()}>
        {(entry) => {
          const isSelected = () => entry.key === props.metricKey;
          const w = barWidth();
          const windowHrs = WINDOW_HOURS[entry.key] ?? 5;
          const divisions = windowHrs === 168 ? 7 : 5;
          const timePct = () => {
            tick();
            return calculateTimeProgress(entry.data.resets, windowHrs);
          };

          return (
            <box flexDirection="column" width="100%" paddingLeft={2} paddingTop={1}>
              <text
                content={`${isSelected() ? "\u25b8 " : "  "}${entry.label}`}
                fg={isSelected() ? theme.green : theme.cyan}
                bold={true}
                height={1}
              />
              {(() => {
                const pred = props.prediction?.[entry.key];
                if (pred && (entry.key === "week_all" || entry.key === "week_sonnet" || entry.key === "weekly")) {
                  const predictedPct = Math.max(0, pred.projectedTotal - pred.usedSoFar);
                  const segments = createPredictionBar(entry.data.used_pct, predictedPct, w);
                  const spareTxt = pred.overBudget
                    ? `OVER BUDGET ${Math.round(pred.predictedSpare)}%`
                    : `${Math.round(pred.predictedSpare)}% spare`;
                  const dimPred = pred.confidence === "low";
                  const sparePrefix = pred.confidence === "low" ? "~" : "";
                  return (
                    <box flexDirection="row" height={1}>
                      <text content={"  "} />
                      <text content={segments.used} fg={theme.text} />
                      <text content={segments.predicted} fg={theme.yellow} dim={dimPred} />
                      <text content={segments.spare} fg={theme.cyan} />
                      <text
                        content={` ${Math.round(entry.data.used_pct)}% used \u2502 ${sparePrefix}${spareTxt}`}
                        fg={pred.overBudget ? theme.red : theme.subtext}
                        bold={pred.overBudget}
                      />
                    </box>
                  );
                }
                return (
                  <text
                    content={`  ${createCapacityBar(entry.data.used_pct, w)} \u25c6 ${Math.round(entry.data.used_pct)}%`}
                    fg={theme.text}
                    height={1}
                  />
                );
              })()}
              <text
                content={`  ${createTimeMarkers(divisions, w)}`}
                fg={theme.surface1}
                dim={true}
                height={1}
              />
              <text
                content={`  ${createPeriodBar(timePct(), w)} \u23f1 ${Math.round(timePct())}%`}
                fg={theme.cyan}
                dim={true}
                height={1}
              />
              <text
                content={`    Resets: ${entry.data.resets}`}
                fg={theme.subtext}
                height={1}
              />
            </box>
          );
        }}
      </For>

      <box flexGrow={1} />
      <text
        content="  Press g or Escape to return"
        fg={theme.surface1}
        height={1}
        paddingLeft={1}
      />
    </box>
  );
}
