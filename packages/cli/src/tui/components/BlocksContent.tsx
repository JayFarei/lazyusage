/**
 * Blocks tab: 5h billing block details for Claude, N/A for Codex.
 */
import { For, Show } from "solid-js";
import { theme } from "../theme.js";
import type { SessionBlock } from "../hooks/useCcusageData.js";

interface BlocksContentProps {
  blocks: SessionBlock[] | null;
  service: "claude" | "codex";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, "0")}${period}`;
}

function fmtDate(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()} ${fmtTime(d)}`;
}

const LBL = 16;
const VAL = 14;
const COL_DATE = 22;
const COL_TOKENS = 14;
const COL_COST = 10;
const LIST_WIDTH = COL_DATE + COL_TOKENS + COL_COST;

export function BlocksContent(props: BlocksContentProps) {
  if (props.service === "codex") {
    return (
      <box flexDirection="column" width="100%" height="100%" paddingLeft={2} paddingTop={1}>
        <text content="  Billing blocks not available for Codex" fg={theme.subtext} height={1} />
        <box flexGrow={1} />
      </box>
    );
  }

  const activeBlock = () => {
    if (!props.blocks || props.blocks.length === 0) return null;
    return props.blocks.find((b) => b.isActive) ?? props.blocks[0];
  };

  const filteredBlocks = () => {
    if (!props.blocks) return [];
    return props.blocks.filter((b) => !b.isGap);
  };

  return (
    <box flexDirection="column" width="100%" paddingLeft={2} paddingTop={1}>
      <Show when={!props.blocks || props.blocks.length === 0}>
        <text content="  No block data available" fg={theme.subtext} height={1} />
      </Show>
      <Show when={activeBlock()}>
        {(() => {
          const blk = () => activeBlock()!;
          const start = () => new Date(blk().startTime);
          const end = () => new Date(blk().endTime);
          const tokens = () => blk().tokenCounts;
          const cacheRead = () => tokens().cacheReadTokens ?? 0;
          const cacheCreate = () => tokens().cacheCreationTokens ?? 0;
          const cacheTotal = () => cacheRead() + cacheCreate();
          return (
            <box flexDirection="column" width="100%">
              <text
                content={blk().isActive ? "Active Block" : "Latest Block"}
                fg={theme.cyan}
                bold={true}
                height={1}
              />
              <text content="" height={1} />
              <text
                content={`  ${"Period:".padEnd(LBL)}${fmtDate(start())} - ${fmtTime(end())}`}
                fg={theme.text}
                height={1}
              />
              <text
                content={`  ${"Input:".padEnd(LBL)}${fmt(tokens().inputTokens).padStart(VAL)}`}
                fg={theme.text}
                height={1}
              />
              <text
                content={`  ${"Output:".padEnd(LBL)}${fmt(tokens().outputTokens).padStart(VAL)}`}
                fg={theme.text}
                height={1}
              />
              <Show when={cacheTotal() > 0}>
                <text
                  content={`  ${"Cache:".padEnd(LBL)}${fmt(cacheTotal()).padStart(VAL)}  (read: ${fmt(cacheRead())}, create: ${fmt(cacheCreate())})`}
                  fg={theme.text}
                  height={1}
                />
              </Show>
              <text
                content={`  ${"Cost:".padEnd(LBL)}${fmtCost(blk().costUSD).padStart(VAL)}`}
                fg={theme.text}
                height={1}
              />
              <text
                content={`  ${"Models:".padEnd(LBL)}${blk().models.join(", ")}`}
                fg={theme.subtext}
                height={1}
              />
              <text content="" height={1} />
              <text content="Recent Blocks" fg={theme.cyan} bold={true} height={1} />
              <text content={"  " + "\u2500".repeat(LIST_WIDTH)} fg={theme.surface1} height={1} />
              <For each={filteredBlocks()}>
                {(b) => {
                  const s = new Date(b.startTime);
                  return (
                    <text
                      content={`  ${fmtDate(s).padEnd(COL_DATE)}${fmt(b.tokenCounts.inputTokens + b.tokenCounts.outputTokens).padStart(COL_TOKENS)} tok${fmtCost(b.costUSD).padStart(COL_COST)}${b.isActive ? "  *" : ""}`}
                      fg={b.isActive ? theme.green : theme.text}
                      height={1}
                    />
                  );
                }}
              </For>
            </box>
          );
        })()}
      </Show>
    </box>
  );
}
