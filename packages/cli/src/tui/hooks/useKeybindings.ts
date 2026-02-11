/**
 * Keyboard event handler hook for panel-based navigation.
 */
import type { ActivePanel } from "./useViewMode.js";

export interface KeybindingHandlers {
  setActivePanel: (panel: ActivePanel) => void;
  navigateMetric: (direction: "up" | "down") => void;
  cycleTab: (direction: "left" | "right") => void;
  togglePause: () => void;
  triggerRefresh: () => void;
  speedUp: () => void;
  slowDown: () => void;
  setHelpVisible: (visible: boolean) => void;
  helpVisible: () => boolean;
  quit: () => void;
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

    switch (key) {
      // Panel focus
      case "1":
        handlers.setActivePanel("claude");
        break;
      case "2":
        handlers.setActivePanel("codex");
        break;

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

      // Quit
      case "q":
        handlers.quit();
        break;
    }
  };
}
