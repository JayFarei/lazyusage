/**
 * Panel-based state management hook.
 * Manages active panel, selected metric, and content tab.
 */
import { createSignal } from "solid-js";

export type ActivePanel = "claude" | "codex";
export type ContentTab = "daily" | "blocks" | "sessions" | "monthly";

const METRIC_KEYS_MAP: Record<ActivePanel, string[]> = {
  claude: ["session", "week_all", "week_sonnet"],
  codex: ["5h", "weekly"],
};

export function usePanelState() {
  const [activePanel, setActivePanelRaw] = createSignal<ActivePanel>("claude");
  const [contentTab, setContentTab] = createSignal<ContentTab>("daily");
  const [selectedMetricIndex, setSelectedMetricIndex] = createSignal(0);

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
  }

  function cycleTab(direction: "left" | "right") {
    const tabs: ContentTab[] = ["daily", "blocks", "sessions", "monthly"];
    setContentTab((current) => {
      const idx = tabs.indexOf(current);
      if (direction === "right") return tabs[(idx + 1) % tabs.length];
      return tabs[(idx - 1 + tabs.length) % tabs.length];
    });
  }

  return {
    activePanel,
    setActivePanel: switchPanel,
    contentTab,
    setContentTab,
    selectedMetricIndex,
    selectedMetricKey,
    navigateMetric,
    cycleTab,
    metricKeysForPanel,
  };
}
