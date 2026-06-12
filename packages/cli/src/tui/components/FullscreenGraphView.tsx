import type { CapacityPrediction, MetricsDict, ServiceName } from "lazyusage-core";
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

function getWeeklyMetricKey(service: ServiceName, selectedMetricKey: string): string {
  if (service === "codex") {
    return "weekly";
  }

  return selectedMetricKey === "week_sonnet" ? "week_sonnet" : "week_all";
}

function getSessionMetricKey(service: ServiceName): string {
  return service === "codex" ? "5h" : "session";
}

export function FullscreenGraphView(props: FullscreenGraphViewProps) {
  const theme = useTheme();
  const weeklyMetricKey = () => getWeeklyMetricKey(props.service, props.selectedMetricKey);
  const sessionMetricKey = () => getSessionMetricKey(props.service);

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

      <box flexDirection="column" flexGrow={1}>
        <GraphPanel
          service={props.service}
          metricKey={sessionMetricKey()}
          metrics={props.metrics}
          prediction={props.prediction}
          createStore={props.createGraphStore}
          variant="fullscreen"
          showLegend={true}
        />
      </box>

      <text content="  [/] switch tab  g/Esc return" fg={theme.surface1} height={1} paddingLeft={1} />
    </box>
  );
}
