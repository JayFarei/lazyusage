/**
 * Monthly tab: monthly usage summaries for a single service.
 */
import { For, Show } from "solid-js";
import { theme } from "../theme.js";
import type { MonthlyUsage } from "../hooks/useCcusageData.js";

interface MonthlyContentProps {
  data: MonthlyUsage[] | null;
  service: "claude" | "codex";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function friendlyMonth(raw: string): string {
  const months: Record<string, string> = {
    "01": "January", "02": "February", "03": "March",
    "04": "April", "05": "May", "06": "June",
    "07": "July", "08": "August", "09": "September",
    "10": "October", "11": "November", "12": "December",
  };
  const parts = raw.split("-");
  if (parts.length >= 2) {
    const m = months[parts[1]] ?? parts[1];
    return `${m} ${parts[0]}`;
  }
  return raw;
}

const COL_MONTH = 20;
const COL_INPUT = 12;
const COL_OUTPUT = 12;
const COL_COST = 10;
const COL_MODELS = 8;
const TABLE_WIDTH = COL_MONTH + COL_INPUT + COL_OUTPUT + COL_COST + COL_MODELS;

export function MonthlyContent(props: MonthlyContentProps) {
  const rows = () => {
    if (!props.data || props.data.length === 0) return [];
    return props.data.map((d) => ({
      month: friendlyMonth(d.month ?? ""),
      input: fmt(d.inputTokens),
      output: fmt(d.outputTokens),
      cost: fmtCost(d.totalCost ?? 0),
      models: d.modelsUsed?.length ?? 0,
    }));
  };

  const header = "  " +
    "Month".padEnd(COL_MONTH) +
    "Input".padStart(COL_INPUT) +
    "Output".padStart(COL_OUTPUT) +
    "Cost".padStart(COL_COST) +
    "Models".padStart(COL_MODELS);

  const separator = "  " + "\u2500".repeat(TABLE_WIDTH);

  return (
    <box flexDirection="column" width="100%" paddingLeft={2} paddingTop={1}>
      <text content="Monthly Summary" fg={theme.cyan} bold={true} height={1} />
      <text content="" height={1} />
      <Show when={rows().length === 0}>
        <text content="  No monthly data available" fg={theme.subtext} height={1} />
      </Show>
      <Show when={rows().length > 0}>
        <text content={header} fg={theme.subtext} height={1} />
        <text content={separator} fg={theme.surface1} height={1} />
        <For each={rows()}>
          {(row) => (
            <text
              content={`  ${row.month.padEnd(COL_MONTH)}${row.input.padStart(COL_INPUT)}${row.output.padStart(COL_OUTPUT)}${row.cost.padStart(COL_COST)}${String(row.models).padStart(COL_MODELS)}`}
              fg={theme.text}
              height={1}
            />
          )}
        </For>
      </Show>
    </box>
  );
}
