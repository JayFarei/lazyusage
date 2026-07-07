/**
 * Integration tests for service filter and single-service keybinding behavior.
 *
 * Tests that `usage claude` shows only Claude panel and `usage codex` shows only Codex
 * at the component level. Full App-level filter is verified by E2E tests.
 */
import { describe, expect, mock, test } from "bun:test";
import { ServicePanel } from "../../../packages/cli/src/tui/components/ServicePanel.js";
import type { KeybindingHandlers } from "../../../packages/cli/src/tui/hooks/useKeybindings.js";
import { createKeybindingHandler } from "../../../packages/cli/src/tui/hooks/useKeybindings.js";
import { mockClaudeMetrics, mockCodexMetrics, renderComponent } from "../helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a full KeybindingHandlers object with all required keys. */
function makeFullHandlers(overrides: Partial<KeybindingHandlers> = {}): KeybindingHandlers {
  return {
    setActivePanel: mock((_panel: "claude" | "codex") => {}),
    focusStatsPanel: mock((_panel: "claude" | "codex") => {}),
    navigateMetric: mock((_direction: "up" | "down") => {}),
    cycleTab: mock((_direction: "left" | "right") => {}),
    togglePause: mock(() => {}),
    triggerRefresh: mock(() => {}),
    speedUp: mock(() => {}),
    slowDown: mock(() => {}),
    setHelpVisible: mock((_visible: boolean) => {}),
    helpVisible: () => false,
    quit: mock(() => {}),
    switchFocusSide: mock(() => {}),
    toggleFullscreen: mock(() => {}),
    exitFullscreen: mock(() => {}),
    fullscreenActive: () => false,
    cycleSortColumn: mock(() => {}),
    toggleSortDirection: mock(() => {}),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ServicePanel: service-specific rendering
// ---------------------------------------------------------------------------

describe("ServicePanel - service-specific rendering", () => {
  test("claude panel shows Claude metric keys", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="claude"
          title="Claude CLI"
          metrics={mockClaudeMetrics()}
          error={null}
          isActive={true}
          selectedIndex={0}
          panelNumber={1}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("Session (5h)");
    expect(frame).toContain("Weekly (All)");
    expect(frame).toContain("Weekly (Fable)");
  });

  test("codex panel shows only Codex metric keys", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="codex"
          title="Codex CLI"
          metrics={mockCodexMetrics()}
          error={null}
          isActive={true}
          selectedIndex={0}
          panelNumber={2}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("Session (5h)");
    expect(frame).toContain("Weekly");
    expect(frame).not.toContain("Weekly (All)");
    expect(frame).not.toContain("Weekly (Fable)");
  });
});

// ---------------------------------------------------------------------------
// Keybinding: single-service mode
// ---------------------------------------------------------------------------

describe("Keybinding - single service mode", () => {
  test("key '2' still calls setActivePanel (App-level filter handles visibility)", () => {
    let _activePanel = "claude";
    const setActivePanel = mock((panel: string) => {
      _activePanel = panel;
    });
    const handlers = makeFullHandlers({
      setActivePanel: setActivePanel as KeybindingHandlers["setActivePanel"],
    });
    const handleKey = createKeybindingHandler(handlers);

    handleKey({ name: "2" });
    expect(setActivePanel).toHaveBeenCalledWith("codex");
  });
});

// ---------------------------------------------------------------------------
// App module contract
// ---------------------------------------------------------------------------

describe("App module exports", () => {
  test("App is exported as a function", async () => {
    const { App } = await import("../../../packages/cli/src/tui/App.js");
    expect(typeof App).toBe("function");
  });
});
