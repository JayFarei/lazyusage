/**
 * Daily tab: token/cost summary for a single service.
 */
import { Show } from "solid-js";
import { theme } from "../theme.js";
import type { DailyUsage } from "../hooks/useCcusageData.js";

interface DailyContentProps {
  data: DailyUsage[] | null;
  service: "claude" | "codex";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function friendlyDate(dateStr: string): string {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const todayStr = `${y}-${m}-${d}`;
  if (dateStr === todayStr) {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `Today: ${months[today.getMonth()]} ${today.getDate()}`;
  }
  return dateStr;
}

const LBL = 16; // label column width
const VAL = 14; // value column width

export function DailyContent(props: DailyContentProps) {
  const today = () => {
    if (!props.data || props.data.length === 0) return null;
    return props.data[0];
  };

  const dateLabel = () => {
    const d = today();
    if (!d) return "";
    return d.date ? friendlyDate(d.date) : "";
  };

  const inputTokens = () => today()?.inputTokens ?? 0;
  const outputTokens = () => today()?.outputTokens ?? 0;

  const cacheCreate = () => today()?.cacheCreationTokens ?? 0;
  const cacheRead = () => today()?.cacheReadTokens ?? 0;

  const grandTotal = () => inputTokens() + outputTokens() + cacheRead() + cacheCreate();

  const cacheHitRate = () => {
    const total = inputTokens() + cacheRead();
    if (total === 0) return "";
    const rate = (cacheRead() / total * 100).toFixed(0);
    return `  (${rate}% hit rate)`;
  };

  const cost = () => today()?.totalCost ?? 0;

  const models = () => {
    const d = today();
    if (!d) return "";
    const m = d.modelsUsed;
    if (!m || m.length === 0) return "none";
    return m.map((s: string) => s.replace(/^claude-/, "")).join(", ");
  };

  return (
    <box flexDirection="column" width="100%" paddingLeft={2} paddingTop={1}>
      <Show when={!today()}>
        <text content="  No daily data available" fg={theme.subtext} height={1} />
      </Show>
      <Show when={today()}>
        <text content={dateLabel()} fg={theme.cyan} bold={true} height={1} />
        <text content="" height={1} />
        <text
          content={`  ${"Input:".padEnd(LBL)}${fmt(inputTokens()).padStart(VAL)}`}
          fg={theme.text}
          height={1}
        />
        <text
          content={`  ${"Output:".padEnd(LBL)}${fmt(outputTokens()).padStart(VAL)}`}
          fg={theme.text}
          height={1}
        />
        <text
          content={`  ${"Cache read:".padEnd(LBL)}${fmt(cacheRead()).padStart(VAL)}${cacheHitRate()}`}
          fg={theme.text}
          height={1}
        />
        <text
          content={`  ${"Cache create:".padEnd(LBL)}${fmt(cacheCreate()).padStart(VAL)}`}
          fg={theme.text}
          height={1}
        />
        <text content="" height={1} />
        <text
          content={`  ${"Total:".padEnd(LBL)}${fmt(grandTotal()).padStart(VAL)}    Cost: ${fmtCost(cost())}`}
          fg={theme.yellow}
          height={1}
        />
        <text content="" height={1} />
        <text
          content={`  ${"Models:".padEnd(LBL)}${models()}`}
          fg={theme.subtext}
          height={1}
        />
      </Show>
    </box>
  );
}
