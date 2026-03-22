/**
 * Panel-based state management hook.
 * Manages active panel, selected metric, and content tab.
 */
import { createSignal } from "solid-js";
import type { SortDirection } from "../components/DataTable.js";

export type ActivePanel = "claude" | "codex";
export type ContentTab = "daily" | "weekly" | "monthly";

const SORT_COLUMNS = ["totalTokens", "project", "inputTokens", "outputTokens", "pctOfTotal"] as const;
export type LedgerSortColumn = (typeof SORT_COLUMNS)[number];

const METRIC_KEYS_MAP: Record<ActivePanel, string[]> = {
  claude: ["week_all", "week_sonnet", "session"],
  codex: ["weekly", "5h"],
};

export function usePanelState() {
  const [activePanel, setActivePanelRaw] = createSignal<ActivePanel>("claude");
  const [contentTab, setContentTab] = createSignal<ContentTab>("daily");
  const [selectedMetricIndex, setSelectedMetricIndex] = createSignal(0);
  const [focusedSide, setFocusedSide] = createSignal<"service" | "stats">("service");
  const [fullscreenTarget, setFullscreenTarget] = createSignal<"service" | "stats" | null>(null);
  const [sortColumn, setSortColumn] = createSignal<LedgerSortColumn>("totalTokens");
  const [sortDirection, setSortDirection] = createSignal<SortDirection>("desc");

  const metricKeysForPanel = (panel: ActivePanel): string[] =>
    METRIC_KEYS_MAP[panel];

  const selectedMetricKey = () => {
    const keys = metricKeysForPanel(activePanel());
    return keys[selectedMetricIndex()] ?? keys[0];
  };

  function navigateMetric(direction: "up" | "down") {
    const keys = metricKeysForPanel(activePanel());
    setSelectedMetricIndex((i) => {
      if (direction === "up") return Math.max(0, i - 1);
      return Math.min(keys.length - 1, i + 1);
    });
  }

  function switchPanel(panel: ActivePanel) {
    setActivePanelRaw(panel);
    setSelectedMetricIndex(0);
    setFocusedSide("service");
  }

  function focusStatsPanel(panel: ActivePanel) {
    setActivePanelRaw(panel);
    setFocusedSide("stats");
  }

  function cycleTab(direction: "left" | "right") {
    const tabs: ContentTab[] = ["daily", "weekly", "monthly"];
    setContentTab((current) => {
      const idx = tabs.indexOf(current);
      if (direction === "right") return tabs[(idx + 1) % tabs.length];
      return tabs[(idx - 1 + tabs.length) % tabs.length];
    });
  }

  function switchFocusSide() {
    setFocusedSide((s) => (s === "service" ? "stats" : "service"));
  }

  function toggleFullscreen() {
    setFullscreenTarget((curr) => {
      const side = focusedSide();
      return curr === side ? null : side;
    });
  }

  function exitFullscreen() {
    setFullscreenTarget(null);
  }

  function cycleSortColumn() {
    setSortColumn((current) => {
      const idx = SORT_COLUMNS.indexOf(current);
      return SORT_COLUMNS[(idx + 1) % SORT_COLUMNS.length];
    });
  }

  function toggleSortDirection() {
    setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
  }

  const sortState = () => ({ column: sortColumn(), direction: sortDirection() });

  return {
    activePanel,
    setActivePanel: switchPanel,
    focusStatsPanel,
    contentTab,
    setContentTab,
    selectedMetricIndex,
    selectedMetricKey,
    navigateMetric,
    cycleTab,
    metricKeysForPanel,
    focusedSide,
    fullscreenTarget,
    switchFocusSide,
    toggleFullscreen,
    exitFullscreen,
    sortState,
    cycleSortColumn,
    toggleSortDirection,
  };
}
