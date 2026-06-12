/**
 * Per-service stats panel showing per-project usage ledger.
 * Displays one bordered box with tab header, switches content based on shared contentTab.
 */

import type { CapacityPrediction, MetricsDict } from "@lazyusage/core";
import type { ProjectUsage } from "@lazyusage/core/parsers/types";
import { Show } from "solid-js";
import type { ContentTab } from "../hooks/useViewMode.js";
import { ROUNDED_BORDER_STYLE } from "../lib/borderStyle.js";
import { useTheme } from "../theme.js";
import type { SortState } from "./DataTable.js";
import { GraphPanel, type GraphStore } from "./GraphPanel.js";
import { LedgerContent } from "./LedgerContent.js";

type StatsTab = ContentTab | "graph";

export interface StatsPanelProps {
  contentTab: StatsTab;
  service: "claude" | "codex";
  daily: ProjectUsage[] | null;
  weekly: ProjectUsage[] | null;
  monthly: ProjectUsage[] | null;
  graphAvailable?: boolean;
  graphMetricKey?: string;
  graphMetrics?: MetricsDict | null;
  graphPrediction?: Record<string, CapacityPrediction> | null;
  createGraphStore?: () => GraphStore;
  loading: boolean;
  error?: string | null;
  isActive?: boolean;
  panelNumber?: number;
  sortState?: SortState<ProjectUsage>;
  onSort?: (column: keyof ProjectUsage) => void;
}

const DEFAULT_TABS: ContentTab[] = ["daily", "weekly", "monthly"];

const TAB_LABELS: Record<StatsTab, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  graph: "Graph",
};

export function StatsPanel(props: StatsPanelProps) {
  const theme = useTheme();
  const tabs = (): StatsTab[] => (props.graphAvailable ? [...DEFAULT_TABS, "graph"] : DEFAULT_TABS);
  const graphMetricKey = (): string => {
    if (!props.graphMetricKey) {
      throw new Error("Graph metric key is required when the graph tab is active");
    }

    return props.graphMetricKey;
  };

  const tabHeader = () =>
    tabs()
      .map((tab) => {
        const isActive = tab === props.contentTab;
        const label = TAB_LABELS[tab];
        return isActive ? `\u2501 ${label} \u2501` : `  ${label}  `;
      })
      .join(" ");

  const titleStr = () => {
    const num = props.panelNumber != null ? `[${props.panelNumber}] ` : "";
    return ` ${num}${tabHeader()} `;
  };

  const hasAnyData = () => !!(props.daily || props.weekly || props.monthly);

  const isCodexNoData = () => props.service === "codex" && !props.loading && !hasAnyData();
  const showGraphTab = () => props.contentTab === "graph" && props.graphAvailable && !!props.graphMetricKey;

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      borderStyle={ROUNDED_BORDER_STYLE}
      borderColor={props.isActive ? theme.cyan : theme.text}
      title={titleStr()}
      titleAlignment="left"
    >
      <Show when={showGraphTab()}>
        <GraphPanel
          service={props.service}
          metricKey={graphMetricKey()}
          metrics={props.graphMetrics ?? null}
          prediction={props.graphPrediction}
          createStore={props.createGraphStore}
        />
      </Show>

      <Show when={!showGraphTab()}>
        <Show when={props.error && !hasAnyData()}>
          <text content={`  Error: ${props.error}`} fg={theme.red} height={1} paddingTop={1} />
        </Show>

        <Show when={isCodexNoData() && !props.error}>
          <text content="  Codex token stats not available" fg={theme.subtext} height={1} paddingTop={1} />
        </Show>

        <Show when={!isCodexNoData() || hasAnyData()}>
          <Show when={props.loading && !hasAnyData()}>
            <text content="  Loading ledger data..." fg={theme.subtext} height={1} paddingTop={1} />
          </Show>

          <Show when={!props.loading || hasAnyData()}>
            <Show when={props.contentTab === "daily"}>
              <scrollbox
                scrollY={true}
                flexGrow={1}
                width="100%"
                verticalScrollbarOptions={{
                  showArrows: true,
                  trackOptions: { backgroundColor: theme.surface0 },
                }}
              >
                <LedgerContent
                  data={props.daily}
                  service={props.service}
                  title="Today"
                  sortState={props.sortState}
                  onSort={props.onSort}
                />
              </scrollbox>
            </Show>

            <Show when={props.contentTab === "weekly"}>
              <scrollbox
                scrollY={true}
                flexGrow={1}
                width="100%"
                verticalScrollbarOptions={{
                  showArrows: true,
                  trackOptions: { backgroundColor: theme.surface0 },
                }}
              >
                <LedgerContent
                  data={props.weekly}
                  service={props.service}
                  title="Last 7 Days"
                  sortState={props.sortState}
                  onSort={props.onSort}
                />
              </scrollbox>
            </Show>

            <Show when={props.contentTab === "monthly"}>
              <scrollbox
                scrollY={true}
                flexGrow={1}
                width="100%"
                verticalScrollbarOptions={{
                  showArrows: true,
                  trackOptions: { backgroundColor: theme.surface0 },
                }}
              >
                <LedgerContent
                  data={props.monthly}
                  service={props.service}
                  title="Last 28 Days"
                  sortState={props.sortState}
                  onSort={props.onSort}
                />
              </scrollbox>
            </Show>
          </Show>
        </Show>
      </Show>
    </box>
  );
}
