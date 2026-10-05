/**
 * Keyboard event handler hook for panel-based navigation.
 */
import type { ServiceName } from "lazyusage-core";
import type { ActivePanel } from "./useViewMode.js";

/** Number keys that focus each service's bars and stats panels (also shown as panel numbers). */
export const PANEL_KEYS: Record<ServiceName, { bars: string; stats: string }> = {
  claude: { bars: "1", stats: "3" },
  codex: { bars: "2", stats: "4" },
  grok: { bars: "5", stats: "6" },
};

const BARS_KEY_TO_SERVICE = new Map(
  (Object.entries(PANEL_KEYS) as Array<[ServiceName, { bars: string; stats: string }]>).map(([s, k]) => [k.bars, s]),
);
const STATS_KEY_TO_SERVICE = new Map(
  (Object.entries(PANEL_KEYS) as Array<[ServiceName, { bars: string; stats: string }]>).map(([s, k]) => [k.stats, s]),
);

export interface KeybindingHandlers {
  setActivePanel: (panel: ActivePanel) => void;
  focusStatsPanel: (panel: ActivePanel) => void;
  navigateMetric: (direction: "up" | "down") => void;
  cycleTab: (direction: "left" | "right") => void;
  togglePause: () => void;
  triggerRefresh: () => void;
  speedUp: () => void;
  slowDown: () => void;
  setHelpVisible: (visible: boolean) => void;
  helpVisible: () => boolean;
  quit: () => void;
  switchFocusSide: () => void;
  toggleFullscreen: () => void;
  exitFullscreen: () => void;
  fullscreenActive: () => boolean;
  cycleSortColumn: () => void;
  toggleSortDirection: () => void;
}

export function createKeybindingHandler(handlers: KeybindingHandlers) {
  return function handleKey(event: { name: string; shift?: boolean }) {
    const key = event.name;

    // Help overlay toggle
    if (key === "?" || (key === "/" && event.shift)) {
      handlers.setHelpVisible(!handlers.helpVisible());
      return;
    }

    // If help is visible, any key closes it
    if (handlers.helpVisible()) {
      handlers.setHelpVisible(false);
      return;
    }

    // Panel focus
    const barsService = BARS_KEY_TO_SERVICE.get(key);
    if (barsService) {
      handlers.setActivePanel(barsService);
      return;
    }
    const statsService = STATS_KEY_TO_SERVICE.get(key);
    if (statsService) {
      handlers.focusStatsPanel(statsService);
      return;
    }

    switch (key) {
      // Metric navigation
      case "j":
      case "down":
        handlers.navigateMetric("down");
        break;
      case "k":
      case "up":
        handlers.navigateMetric("up");
        break;

      // Tab cycling
      case "[":
        handlers.cycleTab("left");
        break;
      case "]":
        handlers.cycleTab("right");
        break;

      // Refresh controls
      case "r":
        handlers.triggerRefresh();
        break;
      case "p":
        handlers.togglePause();
        break;
      case "+":
      case "=":
        handlers.speedUp();
        break;
      case "-":
      case "_":
        handlers.slowDown();
        break;

      // Sort controls
      case "s":
        if (event.shift) {
          handlers.toggleSortDirection();
        } else {
          handlers.cycleSortColumn();
        }
        break;

      // Focus side toggle
      case "tab":
        handlers.switchFocusSide();
        break;

      // Fullscreen toggle
      case "g":
        handlers.toggleFullscreen();
        break;

      // Close fullscreen
      case "escape":
        if (handlers.fullscreenActive()) {
          handlers.exitFullscreen();
        }
        break;

      // Quit
      case "q":
        handlers.quit();
        break;
    }
  };
}
