/**
 * Integration tests for service filter and single-service keybinding behavior.
 *
 * Tests that `usage claude` shows only Claude panel and `usage codex` shows only Codex
 * at the component level. Full App-level filter is verified by E2E tests.
 */
import { describe, test, expect, mock } from "bun:test";
import { renderComponent } from "../helpers.js";
import { ServicePanel } from "../../../packages/cli/src/tui/components/ServicePanel.js";
import { mockClaudeMetrics, mockCodexMetrics } from "../helpers.js";
import { createKeybindingHandler } from "../../../packages/cli/src/tui/hooks/useKeybindings.js";
import type { KeybindingHandlers } from "../../../packages/cli/src/tui/hooks/useKeybindings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a full KeybindingHandlers object with all required keys. */
function makeFullHandlers(overrides: Partial<KeybindingHandlers> = {}): KeybindingHandlers {
  return {
    setActivePanel: mock(() => {}) as any,
    focusStatsPanel: mock(() => {}) as any,
    navigateMetric: mock(() => {}) as any,
    cycleTab: mock(() => {}) as any,
    togglePause: mock(() => {}) as any,
    triggerRefresh: mock(() => {}) as any,
    speedUp: mock(() => {}) as any,
    slowDown: mock(() => {}) as any,
    setHelpVisible: mock(() => {}) as any,
    helpVisible: () => false,
    quit: mock(() => {}) as any,
    switchFocusSide: mock(() => {}) as any,
    toggleFullscreen: mock(() => {}) as any,
    exitFullscreen: mock(() => {}) as any,
    fullscreenActive: () => false,
    cycleSortColumn: mock(() => {}) as any,
    toggleSortDirection: mock(() => {}) as any,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ServicePanel: service-specific rendering
// ---------------------------------------------------------------------------

describe("ServicePanel - service-specific rendering", () => {
  test("claude panel shows Claude metric keys", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <ServicePanel
        service="claude"
        title="Claude CLI"
        metrics={mockClaudeMetrics()}
        error={null}
        isActive={true}
        selectedIndex={0}
        panelNumber={1}
      />
    ), { width: 120, height: 40 });
    const frame = captureCharFrame();
    expect(frame).toContain("Session (5h)");
    expect(frame).toContain("Weekly (All)");
    expect(frame).toContain("Weekly (Sonnet)");
  });

  test("codex panel shows only Codex metric keys", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <ServicePanel
        service="codex"
        title="Codex CLI"
        metrics={mockCodexMetrics()}
        error={null}
        isActive={true}
        selectedIndex={0}
        panelNumber={2}
      />
    ), { width: 120, height: 40 });
    const frame = captureCharFrame();
    expect(frame).toContain("Session (5h)");
    expect(frame).toContain("Weekly");
    expect(frame).not.toContain("Weekly (All)");
    expect(frame).not.toContain("Weekly (Sonnet)");
  });
});

// ---------------------------------------------------------------------------
// Keybinding: single-service mode
// ---------------------------------------------------------------------------

describe("Keybinding - single service mode", () => {
  test("key '2' still calls setActivePanel (App-level filter handles visibility)", () => {
    let activePanel = "claude";
    const setActivePanel = mock((panel: string) => { activePanel = panel; });
    const handlers = makeFullHandlers({ setActivePanel: setActivePanel as any });
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
