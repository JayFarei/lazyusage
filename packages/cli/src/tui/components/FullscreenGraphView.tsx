import {
  type CapacityPrediction,
  type MetricsDict,
  SERVICES,
  SESSION_WINDOW_HOURS,
  type ServiceName,
} from "lazyusage-core";
import { Show } from "solid-js";
import { ROUNDED_BORDER_STYLE } from "../lib/borderStyle.js";
import { useTheme } from "../theme.js";
import { GraphPanel, type GraphStore } from "./GraphPanel.js";

interface FullscreenGraphViewProps {
  service: ServiceName;
  selectedMetricKey: string;
  metrics: MetricsDict | null;
  prediction?: Record<string, CapacityPrediction> | null;
  createGraphStore?: () => GraphStore;
}

/** The selected weekly metric when one is selected, else the service's primary weekly metric. */
function getWeeklyMetricKey(service: ServiceName, selectedMetricKey: string): string {
  const weekly = SERVICES[service].predictableMetrics;
  return weekly.includes(selectedMetricKey) ? selectedMetricKey : (weekly[0] ?? selectedMetricKey);
}

/** The service's 5h session metric, or null for services with only a weekly pool (Grok). */
function getSessionMetricKey(service: ServiceName): string | null {
  return SERVICES[service].textMetrics.find((m) => m.windowHours === SESSION_WINDOW_HOURS)?.key ?? null;
}

export function FullscreenGraphView(props: FullscreenGraphViewProps) {
  const theme = useTheme();
  const weeklyMetricKey = () => getWeeklyMetricKey(props.service, props.selectedMetricKey);
  const sessionMetricKey = () => getSessionMetricKey(props.service);
  // Grok, and Codex plans that only report a weekly limit, have no session window to graph
  const hasSessionMetric = () => {
    const key = sessionMetricKey();
    const val = key ? props.metrics?.[key] : undefined;
    return val !== null && val !== undefined && typeof val === "object" && "used_pct" in val;
  };

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      flexDirection="column"
      borderStyle={ROUNDED_BORDER_STYLE}
      borderColor={theme.cyan}
      title=" Graph "
      titleAlignment="left"
      backgroundColor={theme.base}
    >
      <box flexDirection="column" flexGrow={1}>
        <GraphPanel
          service={props.service}
          metricKey={weeklyMetricKey()}
          metrics={props.metrics}
          prediction={props.prediction}
          createStore={props.createGraphStore}
          variant="fullscreen"
          showLegend={false}
        />
      </box>

      <Show when={hasSessionMetric()}>
        <box flexDirection="column" flexGrow={1}>
          <GraphPanel
            service={props.service}
            metricKey={sessionMetricKey() ?? ""}
            metrics={props.metrics}
            prediction={props.prediction}
            createStore={props.createGraphStore}
            variant="fullscreen"
            showLegend={true}
          />
        </box>
      </Show>

      <text content="  [/] switch tab  g/Esc return" fg={theme.surface1} height={1} paddingLeft={1} />
    </box>
  );
}
