/**
 * Per-service stats panel showing ccusage data.
 * Displays one bordered box with tab header, switches content based on shared contentTab.
 */
import { Show } from "solid-js";
import { theme } from "../theme.js";
import { DailyContent } from "./DailyContent.js";
import { BlocksContent } from "./BlocksContent.js";
import { SessionsContent } from "./SessionsContent.js";
import { MonthlyContent } from "./MonthlyContent.js";
import type { ContentTab } from "../hooks/useViewMode.js";
import type { DailyUsage, SessionBlock, SessionUsage, MonthlyUsage } from "../hooks/useCcusageData.js";

export interface StatsPanelProps {
  contentTab: ContentTab;
  service: "claude" | "codex";
  daily: DailyUsage[] | null;
  blocks: SessionBlock[] | null;
  sessions: SessionUsage[] | null;
  monthly: MonthlyUsage[] | null;
  loading: boolean;
  error?: string | null;
}

const TABS: ContentTab[] = ["daily", "blocks", "sessions", "monthly"];

const TAB_LABELS: Record<ContentTab, string> = {
  daily: "Daily",
  blocks: "Blocks",
  sessions: "Sessions",
  monthly: "Monthly",
};

export function StatsPanel(props: StatsPanelProps) {
  const tabHeader = () =>
    TABS.map((tab) => {
      const isActive = tab === props.contentTab;
      const label = TAB_LABELS[tab];
      return isActive ? `\u2501 ${label} \u2501` : `  ${label}  `;
    }).join(" ");

  const hasAnyData = () =>
    !!(props.daily || props.blocks || props.sessions || props.monthly);

  const isCodexNoData = () =>
    props.service === "codex" && !props.loading && !hasAnyData();

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      borderStyle="round"
      borderColor={theme.borderActive}
      title={` ${tabHeader()} `}
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
          <text content="  Loading ccusage data..." fg={theme.subtext} height={1} paddingTop={1} />
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
              <DailyContent data={props.daily} service={props.service} />
            </scrollbox>
          </Show>

          <Show when={props.contentTab === "blocks"}>
            <scrollbox
              scrollY={true}
              flexGrow={1}
              width="100%"
              verticalScrollbarOptions={{
                showArrows: true,
                trackOptions: { backgroundColor: theme.surface0 },
              }}
            >
              <BlocksContent blocks={props.blocks} service={props.service} />
            </scrollbox>
          </Show>

          <Show when={props.contentTab === "sessions"}>
            <scrollbox
              scrollY={true}
              flexGrow={1}
              width="100%"
              verticalScrollbarOptions={{
                showArrows: true,
                trackOptions: { backgroundColor: theme.surface0 },
              }}
            >
              <SessionsContent sessions={props.sessions} service={props.service} />
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
              <MonthlyContent data={props.monthly} service={props.service} />
            </scrollbox>
          </Show>
        </Show>
      </Show>
    </box>
  );
}
