/**
 * Ledger tab: per-project token usage table for a single service.
 * Reused across Daily, Weekly, and Monthly tabs.
 */
import { For, Show, createMemo } from "solid-js";
import { useTheme } from "../theme.js";
import type { ProjectUsage } from "@usage-tui/core/parsers/types";

interface LedgerContentProps {
  data: ProjectUsage[] | null;
  service: "claude" | "codex";
  title: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

const COL_PROJECT = 26;
const COL_TOKENS = 14;
const COL_PCT = 10;
const TABLE_WIDTH = COL_PROJECT + COL_TOKENS + COL_PCT;

export function LedgerContent(props: LedgerContentProps) {
  const theme = useTheme();
  const rows = createMemo(() => {
    if (!props.data || props.data.length === 0) return [];
    return props.data.map((p) => ({
      project: p.project,
      tokens: fmt(p.totalTokens),
      pct: p.pctOfTotal.toFixed(1),
    }));
  });

  const totalTokens = () => {
    if (!props.data) return 0;
    return props.data.reduce((sum, p) => sum + p.totalTokens, 0);
  };

  const header = "  " +
    "Project".padEnd(COL_PROJECT) +
    "Tokens".padStart(COL_TOKENS) +
    "% Total".padStart(COL_PCT);

  const separator = "  " + "\u2500".repeat(TABLE_WIDTH);

  return (
    <box flexDirection="column" width="100%" paddingLeft={2} paddingTop={1}>
      <text content={props.title} fg={theme.cyan} bold={true} height={1} />
      <text content="" height={1} />
      <Show when={rows().length === 0}>
        <text content="  No usage data available" fg={theme.subtext} height={1} />
      </Show>
      <Show when={rows().length > 0}>
        <text content={header} fg={theme.subtext} height={1} />
        <text content={separator} fg={theme.surface1} height={1} />
        <For each={rows()}>
          {(row) => (
            <text
              content={`  ${row.project.slice(0, COL_PROJECT - 2).padEnd(COL_PROJECT)}${row.tokens.padStart(COL_TOKENS)}${(row.pct + "%").padStart(COL_PCT)}`}
              fg={theme.text}
              height={1}
            />
          )}
        </For>
        <text content={separator} fg={theme.surface1} height={1} />
        <text
          content={`  ${"Total".padEnd(COL_PROJECT)}${fmt(totalTokens()).padStart(COL_TOKENS)}`}
          fg={theme.yellow}
          height={1}
        />
      </Show>
    </box>
  );
}
