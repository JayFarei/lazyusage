/**
 * Visual snapshot tests for ServicePanel component.
 */
import { describe, expect, test } from "bun:test";
import { fitMetricRows, ServicePanel } from "../../../packages/cli/src/tui/components/ServicePanel.js";
import { mockClaudeMetrics, mockCodexMetrics, renderComponent, withFrozenTime } from "../helpers.js";

describe("ServicePanel - Claude metrics", () => {
  test("renders all 3 Claude metric labels", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="claude"
          title="Claude CLI"
          metrics={mockClaudeMetrics()}
          error={null}
          isActive={false}
          selectedIndex={-1}
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

  test("renders capacity bar chars (▓ / ░)", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="claude"
          title="Claude CLI"
          metrics={mockClaudeMetrics({ sessionPct: 50 })}
          error={null}
          isActive={false}
          selectedIndex={-1}
          panelNumber={1}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("\u2593"); // ▓ filled
    expect(frame).toContain("\u2591"); // ░ empty
  });

  test("renders time markers (┃)", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="claude"
          title="Claude CLI"
          metrics={mockClaudeMetrics()}
          error={null}
          isActive={false}
          selectedIndex={-1}
          panelNumber={1}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("\u2503"); // ┃
  });

  test("selected metric shows ▸ marker", async () => {
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
    expect(frame).toContain("\u25b8"); // ▸ selection marker
  });

  test("panel title includes panel number", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="claude"
          title="Claude CLI"
          metrics={mockClaudeMetrics()}
          error={null}
          isActive={false}
          selectedIndex={-1}
          panelNumber={1}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("[1]");
    expect(frame).toContain("Claude CLI");
  });

  test("panel title includes subscription type", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="claude"
          title="Claude CLI"
          metrics={mockClaudeMetrics({ subscriptionType: "max" })}
          error={null}
          isActive={false}
          selectedIndex={-1}
          panelNumber={1}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("max");
  });

  test("narrow panel drops subscription suffix but keeps title", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="codex"
          title="Codex CLI"
          metrics={mockCodexMetrics({ subscriptionType: "prolite" })}
          error={null}
          isActive={false}
          selectedIndex={-1}
          panelNumber={2}
        />
      ),
      { width: 70, height: 35 },
    );
    const frame = captureCharFrame();
    // At 70 cols the full " [2] Codex CLI - prolite " title does not fit the
    // border; the suffix is dropped instead of losing the title entirely.
    expect(frame).toContain("Codex CLI");
    expect(frame).not.toContain("prolite");
  });

  test("snapshot with Claude metrics", async () => {
    // Time-elapsed bars and countdowns depend on the clock; freeze it for a stable snapshot
    await withFrozenTime(async () => {
      const { captureCharFrame } = await renderComponent(
        () => (
          <ServicePanel
            service="claude"
            title="Claude CLI"
            metrics={mockClaudeMetrics({ sessionPct: 25, weekAllPct: 50, weekSonnetPct: 10 })}
            error={null}
            isActive={false}
            selectedIndex={-1}
            panelNumber={1}
          />
        ),
        { width: 120, height: 40 },
      );
      expect(captureCharFrame()).toMatchSnapshot();
    });
  });
});

describe("ServicePanel - Codex metrics", () => {
  test("renders 2 Codex metric labels", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="codex"
          title="Codex CLI"
          metrics={mockCodexMetrics()}
          error={null}
          isActive={false}
          selectedIndex={-1}
          panelNumber={2}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("Session (5h)");
    expect(frame).toContain("Weekly");
    // Should NOT contain Fable which is Claude-specific
    expect(frame).not.toContain("Weekly (Fable)");
  });
});

describe("ServicePanel - error and loading states", () => {
  test("shows error message when error provided", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="claude"
          title="Claude CLI"
          metrics={null}
          error="connection timeout"
          isActive={false}
          selectedIndex={-1}
          panelNumber={1}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("Error:");
    expect(frame).toContain("connection timeout");
  });

  test("shows 'Loading...' when no metrics and no error", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="claude"
          title="Claude CLI"
          metrics={null}
          error={null}
          isActive={false}
          selectedIndex={-1}
          panelNumber={1}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("Loading...");
  });
});

describe("ServicePanel - Codex weekly-only metrics", () => {
  test("renders only the Weekly bar and keeps a selection when no 5h window is reported", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <ServicePanel
          service="codex"
          title="Codex CLI"
          metrics={mockCodexMetrics({ omitFiveHour: true, weeklyPct: 28, subscriptionType: "Pro Lite" })}
          error={null}
          isActive={true}
          selectedIndex={1}
          panelNumber={2}
        />
      ),
      { width: 120, height: 40 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("▸ Weekly");
    expect(frame).not.toContain("Session (5h)");
    expect(frame).toContain("28%");
    expect(frame).toContain("Pro Lite");
  });
});

describe("fitMetricRows", () => {
  test("keeps every optional row when there is room", () => {
    expect([...fitMetricRows(8, true)]).toEqual([
      "periodBar",
      "reset",
      "prediction",
      "markers",
      "resetSpacer",
      "trailingSpacer",
    ]);
  });

  test("drops spacers and markers before data rows when height is short", () => {
    expect([...fitMetricRows(5, true)]).toEqual(["periodBar", "reset", "prediction"]);
    expect([...fitMetricRows(4, false)]).toEqual(["periodBar", "reset"]);
    expect([...fitMetricRows(2, true)]).toEqual([]);
  });
});

describe("ServicePanel - short panels (three service rows)", () => {
  test("grok panel stays inside its border at 80x24 with three rows", async () => {
    const { captureCharFrame } = await renderComponent(
      // One of three service rows at 80x24: (24 - 2) / 3 = 7 rows including borders
      () => (
        <box height={7} width="100%">
          <ServicePanel
            service="grok"
            title="Grok Build"
            metrics={{
              subscription_type: "X Premium",
              weekly: { used_pct: 42, remaining_pct: 58, resets: "Oct 12 at 4:00am" },
            }}
            error={null}
            isActive={true}
            selectedIndex={0}
            panelNumber={5}
            panelCount={3}
          />
        </box>
      ),
      { width: 80, height: 24 },
    );
    const lines = captureCharFrame().split("\n");
    const bottom = lines.findIndex((line) => line.includes("\u2570"));
    // Title intact and the bottom border is a clean line (nothing drawn over it)
    expect(lines[0]).toContain("[5] Grok Build - X Premium");
    expect(lines[bottom]).toMatch(/^\u2570\u2500+\u256f\s*$/);
    expect(captureCharFrame()).toContain("\u25c6 42%");
  });
});
