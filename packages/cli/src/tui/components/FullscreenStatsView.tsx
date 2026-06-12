/**
 * Fullscreen overlay for the stats/ledger panel.
 * Reuses LedgerContent at full terminal width.
 */

import type { ProjectUsage } from "@lazyusage/core/parsers/types";
import { Show } from "solid-js";
import type { ContentTab } from "../hooks/useViewMode.js";
import { ROUNDED_BORDER_STYLE } from "../lib/borderStyle.js";
import { useTheme } from "../theme.js";
import type { SortState } from "./DataTable.js";
import { LedgerContent } from "./LedgerContent.js";

const TABS: ContentTab[] = ["daily", "weekly", "monthly"];

const TAB_LABELS: Record<ContentTab, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

interface FullscreenStatsViewProps {
  service: "claude" | "codex";
  contentTab: ContentTab;
  daily: ProjectUsage[] | null;
  weekly: ProjectUsage[] | null;
  monthly: ProjectUsage[] | null;
  loading: boolean;
  error: string | null;
  sortState?: SortState<ProjectUsage>;
  onSort?: (column: keyof ProjectUsage) => void;
}

export function FullscreenStatsView(props: FullscreenStatsViewProps) {
  const theme = useTheme();

  const tabHeader = () =>
    TABS.map((tab) => {
      const isActive = tab === props.contentTab;
      const label = TAB_LABELS[tab];
      return isActive ? `\u2501 ${label} \u2501` : `  ${label}  `;
    }).join(" ");

  const hasAnyData = () => !!(props.daily || props.weekly || props.monthly);

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
      title={` ${tabHeader()} `}
      titleAlignment="left"
      backgroundColor={theme.base}
    >
      <Show when={props.error && !hasAnyData()}>
        <text content={`  Error: ${props.error}`} fg={theme.red} height={1} paddingTop={1} />
      </Show>

      <Show when={props.loading && !hasAnyData()}>
        <text content="  Loading ledger data..." fg={theme.subtext} height={1} paddingTop={1} />
      </Show>

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

      <text
        content="  [/] switch tab  s=sort column  S=sort dir  g/Esc return"
        fg={theme.surface1}
        height={1}
        paddingLeft={1}
      />
    </box>
  );
}
