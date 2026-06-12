/**
 * Visual snapshot tests for StatsPanel component.
 */
import { describe, expect, test } from "bun:test";
import { StatsPanel } from "../../../packages/cli/src/tui/components/StatsPanel.js";
import { mockProjectUsage, renderComponent } from "../helpers.js";

describe("StatsPanel - tab headers", () => {
  test("daily tab is active by default styling", async () => {
    const data = mockProjectUsage();
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="daily"
          service="claude"
          daily={data}
          weekly={data}
          monthly={data}
          loading={false}
          error={null}
        />
      ),
      { width: 80, height: 30 },
    );
    const frame = captureCharFrame();
    // Active tab uses ━ chars around label
    expect(frame).toContain("\u2501 Daily \u2501");
    // Inactive tabs have spaces
    expect(frame).toContain("Weekly");
    expect(frame).toContain("Monthly");
  });

  test("weekly tab active when contentTab=weekly", async () => {
    const data = mockProjectUsage();
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="weekly"
          service="claude"
          daily={data}
          weekly={data}
          monthly={data}
          loading={false}
          error={null}
        />
      ),
      { width: 80, height: 30 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("\u2501 Weekly \u2501");
  });

  test("monthly tab active when contentTab=monthly", async () => {
    const data = mockProjectUsage();
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="monthly"
          service="claude"
          daily={data}
          weekly={data}
          monthly={data}
          loading={false}
          error={null}
        />
      ),
      { width: 80, height: 30 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("\u2501 Monthly \u2501");
  });
});

describe("StatsPanel - loading state", () => {
  test("shows loading message when loading and no data", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="daily"
          service="claude"
          daily={null}
          weekly={null}
          monthly={null}
          loading={true}
          error={null}
        />
      ),
      { width: 80, height: 30 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("Loading ledger data...");
  });

  test("shows data even while loading (shows existing data)", async () => {
    const data = mockProjectUsage();
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="daily"
          service="claude"
          daily={data}
          weekly={null}
          monthly={null}
          loading={true}
          error={null}
        />
      ),
      { width: 80, height: 30 },
    );
    const frame = captureCharFrame();
    // Should show data (not loading message) since we have daily data
    expect(frame).toContain("my-app");
  });
});

describe("StatsPanel - Codex no data state", () => {
  test("shows 'Codex token stats not available' for codex with no data", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="daily"
          service="codex"
          daily={null}
          weekly={null}
          monthly={null}
          loading={false}
          error={null}
        />
      ),
      { width: 80, height: 30 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("Codex token stats not available");
  });
});

describe("StatsPanel - error state", () => {
  test("shows error message when error and no data", async () => {
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="daily"
          service="claude"
          daily={null}
          weekly={null}
          monthly={null}
          loading={false}
          error="Failed to load ledger"
        />
      ),
      { width: 80, height: 30 },
    );
    const frame = captureCharFrame();
    expect(frame).toContain("Error:");
    expect(frame).toContain("Failed to load ledger");
  });
});

describe("StatsPanel - snapshots", () => {
  test("snapshot with daily data", async () => {
    const data = mockProjectUsage();
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="daily"
          service="claude"
          daily={data}
          weekly={data}
          monthly={data}
          loading={false}
          error={null}
        />
      ),
      { width: 80, height: 30 },
    );
    expect(captureCharFrame()).toMatchSnapshot();
  });
});
