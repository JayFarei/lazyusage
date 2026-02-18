/**
 * Tests for usePanelState hook.
 * Uses createRoot from solid-js to provide reactive context.
 */
import { describe, test, expect } from "bun:test";
import { createRoot } from "solid-js";
import { usePanelState } from "../../../packages/cli/src/tui/hooks/useViewMode.js";

describe("usePanelState - switchPanel", () => {
  test("switchPanel resets selectedMetricIndex to 0", () => {
    createRoot((dispose) => {
      const { selectedMetricIndex, navigateMetric, setActivePanel } = usePanelState();
      // Navigate down twice
      navigateMetric("down");
      navigateMetric("down");
      expect(selectedMetricIndex()).toBe(2);
      // Switch panel - should reset index
      setActivePanel("codex");
      expect(selectedMetricIndex()).toBe(0);
      dispose();
    });
  });

  test("switchPanel updates activePanel", () => {
    createRoot((dispose) => {
      const { activePanel, setActivePanel } = usePanelState();
      expect(activePanel()).toBe("claude");
      setActivePanel("codex");
      expect(activePanel()).toBe("codex");
      dispose();
    });
  });
});

describe("usePanelState - navigateMetric", () => {
  test("navigateMetric down increments index", () => {
    createRoot((dispose) => {
      const { selectedMetricIndex, navigateMetric } = usePanelState();
      expect(selectedMetricIndex()).toBe(0);
      navigateMetric("down");
      expect(selectedMetricIndex()).toBe(1);
      dispose();
    });
  });

  test("navigateMetric clamps at max for Claude (3 metrics)", () => {
    createRoot((dispose) => {
      const { selectedMetricIndex, navigateMetric } = usePanelState();
      navigateMetric("down");
      navigateMetric("down");
      navigateMetric("down"); // attempt to go past 2
      navigateMetric("down");
      expect(selectedMetricIndex()).toBe(2); // max index for 3 metrics
      dispose();
    });
  });

  test("navigateMetric up at index 0 stays at 0", () => {
    createRoot((dispose) => {
      const { selectedMetricIndex, navigateMetric } = usePanelState();
      expect(selectedMetricIndex()).toBe(0);
      navigateMetric("up");
      expect(selectedMetricIndex()).toBe(0);
      dispose();
    });
  });

  test("navigateMetric clamps at max for Codex (2 metrics)", () => {
    createRoot((dispose) => {
      const { selectedMetricIndex, navigateMetric, setActivePanel } = usePanelState();
      setActivePanel("codex");
      navigateMetric("down");
      navigateMetric("down"); // attempt to go past 1
      navigateMetric("down");
      expect(selectedMetricIndex()).toBe(1); // max index for 2 metrics
      dispose();
    });
  });
});

describe("usePanelState - cycleTab", () => {
  test("cycleTab right: daily -> weekly -> monthly -> daily", () => {
    createRoot((dispose) => {
      const { contentTab, cycleTab } = usePanelState();
      expect(contentTab()).toBe("daily");
      cycleTab("right");
      expect(contentTab()).toBe("weekly");
      cycleTab("right");
      expect(contentTab()).toBe("monthly");
      cycleTab("right");
      expect(contentTab()).toBe("daily"); // wraps
      dispose();
    });
  });

  test("cycleTab left wraps in reverse: daily -> monthly", () => {
    createRoot((dispose) => {
      const { contentTab, cycleTab } = usePanelState();
      expect(contentTab()).toBe("daily");
      cycleTab("left");
      expect(contentTab()).toBe("monthly"); // wraps to end
      cycleTab("left");
      expect(contentTab()).toBe("weekly");
      cycleTab("left");
      expect(contentTab()).toBe("daily");
      dispose();
    });
  });
});
