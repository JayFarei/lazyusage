/**
 * Per-service stats panel showing per-project usage ledger.
 * Displays one bordered box with tab header, switches content based on shared contentTab.
 */
import { Show } from "solid-js";
import { useTheme } from "../theme.js";
import { LedgerContent } from "./LedgerContent.js";
import type { ContentTab } from "../hooks/useViewMode.js";
import type { ProjectUsage } from "@usage-tui/core/parsers/types";

export interface StatsPanelProps {
  contentTab: ContentTab;
  service: "claude" | "codex";
  daily: ProjectUsage[] | null;
  weekly: ProjectUsage[] | null;
  monthly: ProjectUsage[] | null;
  loading: boolean;
  error?: string | null;
  isActive?: boolean;
  panelNumber?: number;
}

const TABS: ContentTab[] = ["daily", "weekly", "monthly"];

const TAB_LABELS: Record<ContentTab, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export function StatsPanel(props: StatsPanelProps) {
  const theme = useTheme();
  const tabHeader = () =>
    TABS.map((tab) => {
      const isActive = tab === props.contentTab;
      const label = TAB_LABELS[tab];
      return isActive ? `\u2501 ${label} \u2501` : `  ${label}  `;
    }).join(" ");

  const titleStr = () => {
    const num = props.panelNumber != null ? `[${props.panelNumber}] ` : "";
    return ` ${num}${tabHeader()} `;
  };

  const hasAnyData = () =>
    !!(props.daily || props.weekly || props.monthly);

  const isCodexNoData = () =>
    props.service === "codex" && !props.loading && !hasAnyData();

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      borderStyle={"rounded" as any}
      borderColor={props.isActive ? theme.cyan : theme.text}
      title={titleStr()}
      titleAlignment="left"
    >
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
              <LedgerContent data={props.daily} service={props.service} title="Today" />
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
              <LedgerContent data={props.weekly} service={props.service} title="Last 7 Days" />
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
              <LedgerContent data={props.monthly} service={props.service} title="Last 28 Days" />
            </scrollbox>
          </Show>
        </Show>
      </Show>
    </box>
  );
}
