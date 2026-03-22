/**
 * Reusable flexbox-based table using OpenTUI's native Yoga layout.
 * Each cell is a <box> with percentage width, giving true responsive columns.
 */
import { For, Show, createMemo } from "solid-js";
import { useTheme } from "../theme.js";

export interface Column<T> {
  key: keyof T;
  label: string;
  width: string;           // Yoga percentage: "33%", "17%", etc.
  align?: "left" | "right";
  format?: (value: T[keyof T], row: T) => string;
  headerFg?: string;
}

export type SortDirection = "asc" | "desc";

export interface SortState<T> {
  column: keyof T;
  direction: SortDirection;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  sortState?: SortState<T>;
  onSort?: (column: keyof T) => void;
  footerRow?: Partial<Record<keyof T, string>>;
  emptyMessage?: string;
}

export function DataTable<T extends Record<string, any>>(props: DataTableProps<T>) {
  const theme = useTheme();

  const sortedData = createMemo(() => {
    const items = [...props.data];
    const sort = props.sortState;
    if (!sort) return items;

    return items.sort((a, b) => {
      const aVal = a[sort.column];
      const bVal = b[sort.column];
      const cmp = typeof aVal === "string"
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number);
      return sort.direction === "asc" ? cmp : -cmp;
    });
  });

  const cellContent = (col: Column<T>, row: T): string => {
    const val = row[col.key];
    if (col.format) return col.format(val, row);
    return String(val ?? "");
  };

  const sortIndicator = (col: Column<T>): string => {
    const sort = props.sortState;
    if (!sort || sort.column !== col.key) return "";
    return sort.direction === "asc" ? " \u25B2" : " \u25BC";
  };

  return (
    <box flexDirection="column" width="100%">
      <Show when={props.data.length === 0}>
        <text
          content={props.emptyMessage ?? "No data available"}
          fg={theme.subtext}
          height={1}
        />
      </Show>
      <Show when={props.data.length > 0}>
        {/* Header row */}
        <box flexDirection="row" height={1} width="100%">
          <For each={props.columns}>
            {(col) => (
              <box width={col.width} height={1}>
                <text
                  content={col.label + sortIndicator(col)}
                  fg={col.headerFg ?? theme.subtext}
                  bold={props.sortState?.column === col.key}
                  height={1}
                />
              </box>
            )}
          </For>
        </box>
        {/* Separator */}
        <box height={1} width="100%">
          <text content={"\u2500".repeat(200)} fg={theme.surface1} height={1} />
        </box>
        {/* Data rows */}
        <For each={sortedData()}>
          {(row) => (
            <box flexDirection="row" height={1} width="100%">
              <For each={props.columns}>
                {(col) => (
                  <box width={col.width} height={1}>
                    <text
                      content={cellContent(col, row)}
                      fg={theme.text}
                      height={1}
                    />
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
        {/* Footer/totals row */}
        <Show when={props.footerRow}>
          <box height={1} width="100%">
            <text content={"\u2500".repeat(200)} fg={theme.surface1} height={1} />
          </box>
          <box flexDirection="row" height={1} width="100%">
            <For each={props.columns}>
              {(col) => (
                <box width={col.width} height={1}>
                  <text
                    content={props.footerRow?.[col.key] ?? ""}
                    fg={theme.yellow}
                    height={1}
                  />
                </box>
              )}
            </For>
          </box>
        </Show>
      </Show>
    </box>
  );
}
