import {
  buildPaceData,
  type CapacityPrediction,
  createTimeAxisTicks,
  getWindowHoursForMetric,
  type MetricData,
  type MetricsDict,
  renderUsageChart,
  type ServiceName,
  UsageStore,
} from "@lazyusage/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, For, Show } from "solid-js";
import { useTheme } from "../theme.js";
import { LABEL_MAP } from "./ServicePanel.js";

export type GraphStore = Pick<UsageStore, "getHistory" | "close">;

interface GraphPanelProps {
  service: ServiceName;
  metricKey: string;
  metrics: MetricsDict | null;
  prediction?: Record<string, CapacityPrediction> | null;
  createStore?: () => GraphStore;
  variant?: "panel" | "fullscreen";
  title?: string;
  showLegend?: boolean;
}

function isMetricData(value: unknown): value is MetricData {
  return (
    typeof value === "object" && value !== null && "used_pct" in value && "remaining_pct" in value && "resets" in value
  );
}

type GraphTone = "default" | "actual" | "pace" | "projected" | "now" | "grid" | "threshold";

interface StyledTextRun {
  content: string;
  fg: string;
}

function isBrailleCell(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x2801 && codePoint <= 0x28ff;
}

function classifyGraphCharacter(character: string): GraphTone {
  if (isBrailleCell(character) || character === "◆") {
    return "actual";
  }

  switch (character) {
    case "·":
      return "pace";
    case "┈":
      return "projected";
    case "│":
      return "now";
    case "┆":
      return "grid";
    case "─":
      return "threshold";
    default:
      return "default";
  }
}

function toneToColor(tone: GraphTone, theme: ReturnType<typeof useTheme>): string {
  switch (tone) {
    case "actual":
      return theme.graphActual;
    case "pace":
      return theme.graphPace;
    case "projected":
      return theme.graphProjected;
    case "now":
      return theme.graphNow;
    case "grid":
      return theme.graphGrid;
    case "threshold":
      return theme.graphThreshold;
    default:
      return theme.text;
  }
}

function styleGraphLine(line: string, theme: ReturnType<typeof useTheme>): StyledTextRun[] {
  const characters = Array.from(line);
  const segments: StyledTextRun[] = [];

  for (const character of characters) {
    const fg = toneToColor(classifyGraphCharacter(character), theme);
    const previous = segments.at(-1);

    if (previous && previous.fg === fg) {
      previous.content += character;
      continue;
    }

    segments.push({ content: character, fg });
  }

  return segments;
}

export function GraphPanel(props: GraphPanelProps) {
  const theme = useTheme();
  const dims = useTerminalDimensions();
  const createStore = props.createStore ?? (() => new UsageStore());

  const currentMetric = createMemo(() => {
    const candidate = props.metrics?.[props.metricKey];
    return isMetricData(candidate) ? candidate : null;
  });

  const chartWidth = createMemo(() => {
    const totalWidth = dims().width;
    const reservedWidth = props.variant === "fullscreen" ? 14 : 18;
    return Math.max(24, totalWidth - reservedWidth);
  });

  const chartHeight = createMemo(() => {
    if (props.variant === "fullscreen") {
      return Math.max(8, Math.floor((dims().height - 20) / 2));
    }

    return Math.max(6, Math.floor((dims().height - 16) / 3));
  });

  const graphTitle = createMemo(() => props.title ?? LABEL_MAP[props.metricKey] ?? props.metricKey);

  const graphData = createMemo(() => {
    const metric = currentMetric();
    if (!metric) {
      return null;
    }

    const store = createStore();

    try {
      return buildPaceData(store, props.service, props.metricKey, {
        currentMetric: metric,
        projectedTotalPct: props.prediction?.[props.metricKey]?.projectedTotal ?? null,
      });
    } finally {
      store.close();
    }
  });

  const chart = createMemo(() => {
    const data = graphData();
    if (!data) {
      return null;
    }

    const tickMode = getWindowHoursForMetric(props.metricKey) > 24 ? "weekly" : "session";

    return renderUsageChart({
      points: data.points.map((point) => ({
        timestampMs: point.timestampMs,
        value: point.usedPct,
      })),
      widthCells: chartWidth(),
      heightCells: chartHeight(),
      windowStartMs: data.windowStartMs,
      windowEndMs: data.windowEndMs,
      nowMs: data.nowMs,
      yMaxPct: data.yMaxPct,
      projectedTotalPct: data.projectedTotalPct,
      xTicks: createTimeAxisTicks(tickMode, data.windowStartMs),
    });
  });

  const summary = createMemo(() => {
    const data = graphData();
    if (!data) {
      return null;
    }

    const windowProgress = Math.max(
      0,
      Math.min(100, ((data.nowMs - data.windowStartMs) / Math.max(1, data.windowEndMs - data.windowStartMs)) * 100),
    );
    return {
      now: data.currentUsedPct == null ? "--" : `${Math.round(data.currentUsedPct)}%`,
      pace: `${Math.round(windowProgress)}%`,
      projected: data.projectedTotalPct == null ? "--" : `${Math.round(data.projectedTotalPct)}%`,
    };
  });

  return (
    <box flexDirection="column" width="100%" flexGrow={1}>
      <text content={`  ${graphTitle()}`} fg={theme.cyan} bold={true} height={1} paddingTop={1} />

      <Show
        when={chart()}
        fallback={<text content="  No daemon history collected yet" fg={theme.subtext} height={1} />}
      >
        {(renderedChart) => (
          <>
            <For each={renderedChart().lines}>
              {(line) => (
                <box flexDirection="row" width="100%" height={1}>
                  <For each={styleGraphLine(` ${line}`, theme)}>
                    {(segment) => <text content={segment.content} fg={segment.fg} height={1} />}
                  </For>
                </box>
              )}
            </For>
            <Show when={summary()}>
              {(graphSummary) => (
                <box flexDirection="row" width="100%" height={1}>
                  <text content="  now " fg={theme.graphNow} height={1} />
                  <text content={graphSummary().now} fg={theme.graphNow} bold={true} height={1} />
                  <text content="  pace " fg={theme.graphPace} height={1} />
                  <text content={graphSummary().pace} fg={theme.graphPace} bold={true} height={1} />
                  <text content="  projected " fg={theme.graphProjected} height={1} />
                  <text content={graphSummary().projected} fg={theme.graphProjected} bold={true} height={1} />
                </box>
              )}
            </Show>
            <Show when={props.showLegend ?? true}>
              <box flexDirection="row" width="100%" height={1}>
                <text content="  actual ◆" fg={theme.graphActual} height={1} />
                <text content="  pace ·" fg={theme.graphPace} height={1} />
                <text content="  predicted ┈" fg={theme.graphProjected} height={1} />
                <text content="  now │" fg={theme.graphNow} height={1} />
              </box>
            </Show>
          </>
        )}
      </Show>
    </box>
  );
}
