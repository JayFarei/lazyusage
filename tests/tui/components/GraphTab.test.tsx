import { describe, expect, test } from "bun:test";
import { renderComponent, mockProjectUsage } from "../helpers.js";
import { StatsPanel } from "../../../packages/cli/src/tui/components/StatsPanel.js";

describe("StatsPanel - Graph tab", () => {
  test("shows the Graph tab when daemon-backed graph data is available", async () => {
    const data = mockProjectUsage();
    const { captureCharFrame } = await renderComponent(() => (
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
    ), { width: 80, height: 30 });

    expect(captureCharFrame()).toContain("Graph");
  });
});
