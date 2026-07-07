/**
 * Visual snapshot tests for ServicePanel component.
 */
import { describe, expect, test } from "bun:test";
import { ServicePanel } from "../../../packages/cli/src/tui/components/ServicePanel.js";
import { mockClaudeMetrics, mockCodexMetrics, renderComponent } from "../helpers.js";

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
