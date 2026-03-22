/**
 * Tests for createKeybindingHandler.
 * Pure function - no SolidJS context needed.
 */
import { describe, test, expect, mock } from "bun:test";
import { createKeybindingHandler } from "../../../packages/cli/src/tui/hooks/useKeybindings.js";
import type { KeybindingHandlers } from "../../../packages/cli/src/tui/hooks/useKeybindings.js";

function makeHandlers(overrides: Partial<KeybindingHandlers> = {}): {
  mocks: Record<string, ReturnType<typeof mock>>;
  handlers: KeybindingHandlers;
  helpVisible: boolean;
} {
  let helpVisible = false;
  const mocks = {
    setActivePanel: mock(() => {}),
    focusStatsPanel: mock(() => {}),
    navigateMetric: mock(() => {}),
    cycleTab: mock(() => {}),
    togglePause: mock(() => {}),
    triggerRefresh: mock(() => {}),
    speedUp: mock(() => {}),
    slowDown: mock(() => {}),
    setHelpVisible: mock((v: boolean) => { helpVisible = v; }),
    quit: mock(() => {}),
    switchFocusSide: mock(() => {}),
    toggleFullscreen: mock(() => {}),
    exitFullscreen: mock(() => {}),
    cycleSortColumn: mock(() => {}),
    toggleSortDirection: mock(() => {}),
  };

  const handlers: KeybindingHandlers = {
    setActivePanel: mocks.setActivePanel as any,
    focusStatsPanel: mocks.focusStatsPanel as any,
    navigateMetric: mocks.navigateMetric as any,
    cycleTab: mocks.cycleTab as any,
    togglePause: mocks.togglePause as any,
    triggerRefresh: mocks.triggerRefresh as any,
    speedUp: mocks.speedUp as any,
    slowDown: mocks.slowDown as any,
    setHelpVisible: mocks.setHelpVisible as any,
    helpVisible: () => helpVisible,
    quit: mocks.quit as any,
    switchFocusSide: mocks.switchFocusSide as any,
    toggleFullscreen: mocks.toggleFullscreen as any,
    exitFullscreen: mocks.exitFullscreen as any,
    fullscreenActive: () => false,
    cycleSortColumn: mocks.cycleSortColumn as any,
    toggleSortDirection: mocks.toggleSortDirection as any,
    ...overrides,
  };

  return { mocks, handlers, get helpVisible() { return helpVisible; } };
}

describe("createKeybindingHandler - panel focus", () => {
  test("key '1' calls setActivePanel('claude')", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "1" });
    expect(mocks.setActivePanel).toHaveBeenCalledWith("claude");
  });

  test("key '2' calls setActivePanel('codex')", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "2" });
    expect(mocks.setActivePanel).toHaveBeenCalledWith("codex");
  });
});

describe("createKeybindingHandler - metric navigation", () => {
  test("key 'j' calls navigateMetric('down')", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "j" });
    expect(mocks.navigateMetric).toHaveBeenCalledWith("down");
  });

  test("key 'k' calls navigateMetric('up')", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "k" });
    expect(mocks.navigateMetric).toHaveBeenCalledWith("up");
  });

  test("key 'down' calls navigateMetric('down')", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "down" });
    expect(mocks.navigateMetric).toHaveBeenCalledWith("down");
  });

  test("key 'up' calls navigateMetric('up')", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "up" });
    expect(mocks.navigateMetric).toHaveBeenCalledWith("up");
  });
});

describe("createKeybindingHandler - tab cycling", () => {
  test("key '[' calls cycleTab('left')", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "[" });
    expect(mocks.cycleTab).toHaveBeenCalledWith("left");
  });

  test("key ']' calls cycleTab('right')", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "]" });
    expect(mocks.cycleTab).toHaveBeenCalledWith("right");
  });
});

describe("createKeybindingHandler - refresh controls", () => {
  test("key 'r' calls triggerRefresh", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "r" });
    expect(mocks.triggerRefresh).toHaveBeenCalled();
  });

  test("key 'p' calls togglePause", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "p" });
    expect(mocks.togglePause).toHaveBeenCalled();
  });

  test("key '+' calls speedUp", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "+" });
    expect(mocks.speedUp).toHaveBeenCalled();
  });

  test("key '=' calls speedUp", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "=" });
    expect(mocks.speedUp).toHaveBeenCalled();
  });

  test("key '-' calls slowDown", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "-" });
    expect(mocks.slowDown).toHaveBeenCalled();
  });

  test("key '_' calls slowDown", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "_" });
    expect(mocks.slowDown).toHaveBeenCalled();
  });
});

describe("createKeybindingHandler - quit", () => {
  test("key 'q' calls quit", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "q" });
    expect(mocks.quit).toHaveBeenCalled();
  });
});

describe("createKeybindingHandler - sort controls", () => {
  test("key 's' calls cycleSortColumn", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "s" });
    expect(mocks.cycleSortColumn).toHaveBeenCalled();
    expect(mocks.toggleSortDirection).not.toHaveBeenCalled();
  });

  test("key 's' with shift calls toggleSortDirection", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "s", shift: true });
    expect(mocks.toggleSortDirection).toHaveBeenCalled();
    expect(mocks.cycleSortColumn).not.toHaveBeenCalled();
  });
});

describe("createKeybindingHandler - help overlay", () => {
  test("'?' toggles help visible", () => {
    const { mocks, handlers } = makeHandlers();
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "?" });
    expect(mocks.setHelpVisible).toHaveBeenCalledWith(true);
  });

  test("any key while help visible closes it", () => {
    const { mocks, handlers } = makeHandlers({
      helpVisible: () => true,
    });
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "j" });
    expect(mocks.setHelpVisible).toHaveBeenCalledWith(false);
  });

  test("'?' closes help if already visible", () => {
    const { mocks, handlers } = makeHandlers({
      helpVisible: () => true,
    });
    const handleKey = createKeybindingHandler(handlers);
    handleKey({ name: "?" });
    expect(mocks.setHelpVisible).toHaveBeenCalledWith(false);
  });
});
