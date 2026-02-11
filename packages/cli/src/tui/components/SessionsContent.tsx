/**
 * Sessions tab: recent sessions for a single service.
 */
import { For, Show } from "solid-js";
import { theme } from "../theme.js";
import type { SessionUsage } from "../hooks/useCcusageData.js";

interface SessionsContentProps {
  sessions: SessionUsage[] | null;
  service: "claude" | "codex";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function shortProject(path: string): string {
  if (!path) return "unknown";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path.slice(0, 24);
}

function friendlyTimestamp(raw: string): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const h = d.getHours();
      const m = d.getMinutes();
      const period = h >= 12 ? "pm" : "am";
      const h12 = h % 12 || 12;
      const timeStr = m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
      return `${months[d.getMonth()]} ${d.getDate()} ${timeStr}`;
    }
  }
  return raw;
}

const COL_PROJECT = 26;
const COL_ACTIVE = 18;
const COL_TOKENS = 14;
const COL_COST = 10;
const TABLE_WIDTH = COL_PROJECT + COL_ACTIVE + COL_TOKENS + COL_COST;

export function SessionsContent(props: SessionsContentProps) {
  const rows = () => {
    if (!props.sessions || props.sessions.length === 0) return [];
    return props.sessions.map((s) => ({
      project: shortProject(s.projectPath ?? ""),
      lastActive: friendlyTimestamp(s.lastActivity ?? ""),
      tokens: fmt(s.inputTokens + s.outputTokens),
      cost: fmtCost(s.totalCost ?? 0),
    }));
  };

  const header = "  " +
    "Project".padEnd(COL_PROJECT) +
    "Last Active".padEnd(COL_ACTIVE) +
    "Tokens".padStart(COL_TOKENS) +
    "Cost".padStart(COL_COST);

  const separator = "  " + "\u2500".repeat(TABLE_WIDTH);

  return (
    <box flexDirection="column" width="100%" paddingLeft={2} paddingTop={1}>
      <text content="Recent Sessions" fg={theme.cyan} bold={true} height={1} />
      <text content="" height={1} />
      <Show when={rows().length === 0}>
        <text content="  No session data available" fg={theme.subtext} height={1} />
      </Show>
      <Show when={rows().length > 0}>
        <text content={header} fg={theme.subtext} height={1} />
        <text content={separator} fg={theme.surface1} height={1} />
        <For each={rows()}>
          {(row) => (
            <text
              content={`  ${row.project.slice(0, COL_PROJECT - 2).padEnd(COL_PROJECT)}${row.lastActive.slice(0, COL_ACTIVE - 2).padEnd(COL_ACTIVE)}${row.tokens.padStart(COL_TOKENS)}${row.cost.padStart(COL_COST)}`}
              fg={theme.text}
              height={1}
            />
          )}
        </For>
      </Show>
    </box>
  );
}
