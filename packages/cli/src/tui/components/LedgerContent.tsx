/**
 * Ledger tab: per-project token usage table for a single service.
 * Reused across Daily, Weekly, and Monthly tabs.
 */
import { For, Show, createMemo } from "solid-js";
import { useTheme } from "../theme.js";
import type { ProjectUsage } from "@lazyusage/core/parsers/types";

interface LedgerContentProps {
  data: ProjectUsage[] | null;
  service: "claude" | "codex";
  title: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

const COL_PROJECT = 22;
const COL_INPUT = 12;
const COL_OUTPUT = 12;
const COL_TOTAL = 12;
const COL_PCT = 8;
const TABLE_WIDTH = COL_PROJECT + COL_INPUT + COL_OUTPUT + COL_TOTAL + COL_PCT;

export function LedgerContent(props: LedgerContentProps) {
  const theme = useTheme();
  const rows = createMemo(() => {
    if (!props.data || props.data.length === 0) return [];
    return props.data.map((p) => ({
      project: p.project,
      input: fmt(p.inputTokens),
      output: fmt(p.outputTokens),
      total: fmt(p.totalTokens),
      pct: p.pctOfTotal.toFixed(1),
    }));
  });

  const totals = () => {
    if (!props.data) return { input: 0, output: 0, total: 0 };
    return props.data.reduce(
      (acc, p) => ({
        input: acc.input + p.inputTokens,
        output: acc.output + p.outputTokens,
        total: acc.total + p.totalTokens,
      }),
      { input: 0, output: 0, total: 0 },
    );
  };

  const header = "  " +
    "Project".padEnd(COL_PROJECT) +
    "Input".padStart(COL_INPUT) +
    "Output".padStart(COL_OUTPUT) +
    "Total".padStart(COL_TOTAL) +
    "%".padStart(COL_PCT);

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
              content={`  ${(row.project.length > COL_PROJECT - 2 ? row.project.slice(0, COL_PROJECT - 4) + ".." : row.project).padEnd(COL_PROJECT)}${row.input.padStart(COL_INPUT)}${row.output.padStart(COL_OUTPUT)}${row.total.padStart(COL_TOTAL)}${(row.pct + "%").padStart(COL_PCT)}`}
              fg={theme.text}
              height={1}
            />
          )}
        </For>
        <text content={separator} fg={theme.surface1} height={1} />
        <text
          content={`  ${"Total".padEnd(COL_PROJECT)}${fmt(totals().input).padStart(COL_INPUT)}${fmt(totals().output).padStart(COL_OUTPUT)}${fmt(totals().total).padStart(COL_TOTAL)}`}
          fg={theme.yellow}
          height={1}
        />
      </Show>
    </box>
  );
}
