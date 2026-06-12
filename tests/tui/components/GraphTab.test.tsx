import { describe, expect, test } from "bun:test";
import { StatsPanel } from "../../../packages/cli/src/tui/components/StatsPanel.js";
import {
  createMockGraphStore,
  mockClaudeMetrics,
  mockHistoryEntries,
  mockProjectUsage,
  renderComponent,
} from "../helpers.js";

describe("StatsPanel - Graph tab", () => {
  test("shows the Graph tab when daemon-backed graph data is available", async () => {
    const data = mockProjectUsage();
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="daily"
          service="claude"
          daily={data}
          weekly={data}
          monthly={data}
          graphAvailable={true}
          loading={false}
          error={null}
        />
      ),
      { width: 80, height: 30 },
    );

    expect(captureCharFrame()).toContain("Graph");
  });

  test("renders the selected daemon graph when the Graph tab is active", async () => {
    const history = mockHistoryEntries([
      { minutesAgo: 150, usedPct: 12 },
      { minutesAgo: 90, usedPct: 26 },
      { minutesAgo: 30, usedPct: 44 },
    ]);
    const { captureCharFrame } = await renderComponent(
      () => (
        <StatsPanel
          contentTab="graph"
          service="claude"
          daily={null}
          weekly={null}
          monthly={null}
          graphAvailable={true}
          graphMetricKey="session"
          graphMetrics={mockClaudeMetrics()}
          createGraphStore={() => createMockGraphStore({ session: history })}
          loading={false}
          error={null}
        />
      ),
      { width: 120, height: 40 },
    );

    const frame = captureCharFrame();

    expect(frame).toContain("Session (5h)");
    expect(frame).toContain("projected");
    expect(frame).toContain("actual");
    expect(frame).toMatch(/[\u2801-\u28ff]/u);
  });
});
