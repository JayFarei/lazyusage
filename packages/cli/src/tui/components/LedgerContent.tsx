/**
 * Ledger tab: per-project token usage table for a single service.
 * Reused across Daily, Weekly, and Monthly tabs.
 * Uses DataTable for responsive flexbox-based layout.
 */
import { createMemo } from "solid-js";
import { useTheme } from "../theme.js";
import { DataTable, type Column, type SortState } from "./DataTable.js";
import type { ProjectUsage } from "@lazyusage/core/parsers/types";

export type LedgerSortColumn = "project" | "inputTokens" | "outputTokens" | "totalTokens" | "pctOfTotal";

export interface LedgerContentProps {
  data: ProjectUsage[] | null;
  service: "claude" | "codex";
  title: string;
  sortState?: SortState<ProjectUsage>;
  onSort?: (column: keyof ProjectUsage) => void;
}

/** Format large numbers compactly: 1,234 / 1.2M / 1.2B */
function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  return n.toLocaleString("en-US");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

const COLUMNS: Column<ProjectUsage>[] = [
  {
    key: "project",
    label: "Project",
    width: "30%",
    format: (val) => {
      const s = String(val);
      return s.length > 20 ? s.slice(0, 18) + ".." : s;
    },
  },
  {
    key: "inputTokens",
    label: "Input",
    width: "18%",
    format: (val) => fmtCompact(val as number),
  },
  {
    key: "outputTokens",
    label: "Output",
    width: "18%",
    format: (val) => fmtCompact(val as number),
  },
  {
    key: "totalTokens",
    label: "Total",
    width: "18%",
    format: (val) => fmtCompact(val as number),
  },
  {
    key: "pctOfTotal",
    label: "%",
    width: "16%",
    format: (val) => (val as number).toFixed(1) + "%",
  },
];

export function LedgerContent(props: LedgerContentProps) {
  const theme = useTheme();

  const data = createMemo(() => props.data ?? []);

  const footerRow = createMemo(() => {
    const d = data();
    if (d.length === 0) return undefined;
    const totals = d.reduce(
      (acc, p) => ({
        input: acc.input + p.inputTokens,
        output: acc.output + p.outputTokens,
        total: acc.total + p.totalTokens,
      }),
      { input: 0, output: 0, total: 0 },
    );
    return {
      project: "Total",
      inputTokens: fmtCompact(totals.input),
      outputTokens: fmtCompact(totals.output),
      totalTokens: fmtCompact(totals.total),
      pctOfTotal: "",
    } as Partial<Record<keyof ProjectUsage, string>>;
  });

  return (
    <box flexDirection="column" width="100%" paddingLeft={2} paddingTop={1}>
      <text content={props.title} fg={theme.cyan} bold={true} height={1} />
      <text content="" height={1} />
      <DataTable<ProjectUsage>
        columns={COLUMNS}
        data={data()}
        sortState={props.sortState}
        onSort={props.onSort}
        footerRow={footerRow()}
        emptyMessage="No usage data available"
      />
    </box>
  );
}
