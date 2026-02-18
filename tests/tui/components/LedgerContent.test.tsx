/**
 * Visual snapshot tests for LedgerContent component.
 */
import { describe, test, expect } from "bun:test";
import { renderComponent, mockProjectUsage } from "../helpers.js";
import { LedgerContent } from "../../../packages/cli/src/tui/components/LedgerContent.js";

describe("LedgerContent - with data", () => {
  test("renders project names and token counts", async () => {
    const data = mockProjectUsage([
      { project: "my-app", totalTokens: 45000 },
      { project: "other-proj", totalTokens: 20000 },
    ]);
    const { captureCharFrame } = await renderComponent(() => (
      <LedgerContent data={data} service="claude" title="Today" />
    ), { width: 80, height: 20 });
    const frame = captureCharFrame();
    expect(frame).toContain("my-app");
    expect(frame).toContain("other-proj");
    expect(frame).toContain("45,000");
    expect(frame).toContain("20,000");
  });

  test("renders percentage of total", async () => {
    const data = mockProjectUsage([
      { project: "big-proj", totalTokens: 75000, pctOfTotal: 75.0 },
      { project: "small-proj", totalTokens: 25000, pctOfTotal: 25.0 },
    ]);
    const { captureCharFrame } = await renderComponent(() => (
      <LedgerContent data={data} service="claude" title="Today" />
    ), { width: 80, height: 20 });
    const frame = captureCharFrame();
    expect(frame).toContain("75.0%");
    expect(frame).toContain("25.0%");
  });

  test("renders title", async () => {
    const data = mockProjectUsage();
    const { captureCharFrame } = await renderComponent(() => (
      <LedgerContent data={data} service="claude" title="Last 7 Days" />
    ), { width: 80, height: 20 });
    const frame = captureCharFrame();
    expect(frame).toContain("Last 7 Days");
  });

  test("renders total row", async () => {
    const data = mockProjectUsage([
      { project: "proj-a", totalTokens: 60000 },
      { project: "proj-b", totalTokens: 40000 },
    ]);
    const { captureCharFrame } = await renderComponent(() => (
      <LedgerContent data={data} service="claude" title="Today" />
    ), { width: 80, height: 20 });
    const frame = captureCharFrame();
    expect(frame).toContain("Total");
    expect(frame).toContain("100,000"); // 60k + 40k
  });

  test("truncates long project names at 24 chars", async () => {
    const data = mockProjectUsage([
      { project: "a-very-long-project-name-that-exceeds-limit", totalTokens: 1000 },
    ]);
    const { captureCharFrame } = await renderComponent(() => (
      <LedgerContent data={data} service="claude" title="Today" />
    ), { width: 80, height: 15 });
    const frame = captureCharFrame();
    // Project name in LedgerContent is shortened via shortProject() to last path component
    // then truncated to COL_PROJECT-2 = 24 chars in display
    expect(frame).toContain("a-very-long-project-name"); // first 24 chars
  });

  test("snapshot with data", async () => {
    const data = mockProjectUsage();
    const { captureCharFrame } = await renderComponent(() => (
      <LedgerContent data={data} service="claude" title="Today" />
    ), { width: 60, height: 15 });
    expect(captureCharFrame()).toMatchSnapshot();
  });
});

describe("LedgerContent - empty state", () => {
  test("shows 'No usage data available' for null data", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <LedgerContent data={null} service="claude" title="Today" />
    ), { width: 60, height: 10 });
    const frame = captureCharFrame();
    expect(frame).toContain("No usage data available");
  });

  test("shows 'No usage data available' for empty array", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <LedgerContent data={[]} service="claude" title="Today" />
    ), { width: 60, height: 10 });
    const frame = captureCharFrame();
    expect(frame).toContain("No usage data available");
  });
});
