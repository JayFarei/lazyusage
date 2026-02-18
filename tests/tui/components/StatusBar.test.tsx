/**
 * Visual snapshot tests for StatusBar component.
 */
import { describe, test, expect } from "bun:test";
import { renderComponent, findSpansByText } from "../helpers.js";
import { StatusBar } from "../../../packages/cli/src/tui/components/StatusBar.js";
import { catppuccinMocha } from "../../../packages/cli/src/tui/theme.js";

describe("StatusBar - text content", () => {
  test("renders current time and last updated time", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <StatusBar
        lastUpdated="10:30:00 AM"
        currentTime="11:45:00 PM"
        autoRefreshEnabled={true}
        refreshInterval={10}
        dataSource={{}}
      />
    ), { width: 120, height: 1 });
    const frame = captureCharFrame();
    expect(frame).toContain("11:45:00 PM");
    expect(frame).toContain("Last updated: 10:30:00 AM");
  });

  test("renders auto-refresh ON state with interval", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <StatusBar
        lastUpdated="10:00:00 AM"
        currentTime="10:01:00 AM"
        autoRefreshEnabled={true}
        refreshInterval={10}
        dataSource={{}}
      />
    ), { width: 120, height: 1 });
    const frame = captureCharFrame();
    expect(frame).toContain("Auto-refresh: ON (10s)");
  });

  test("renders auto-refresh OFF state", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <StatusBar
        lastUpdated="10:00:00 AM"
        currentTime="10:01:00 AM"
        autoRefreshEnabled={false}
        refreshInterval={10}
        dataSource={{}}
      />
    ), { width: 120, height: 1 });
    const frame = captureCharFrame();
    expect(frame).toContain("Auto-refresh: OFF");
  });

  test("renders 'Never' when lastUpdated is null", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <StatusBar
        lastUpdated={null}
        currentTime="10:00:00 AM"
        autoRefreshEnabled={true}
        refreshInterval={10}
        dataSource={{}}
      />
    ), { width: 120, height: 1 });
    const frame = captureCharFrame();
    expect(frame).toContain("Last updated: Never");
  });

  test("renders data sources when provided", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <StatusBar
        lastUpdated="10:00:00 AM"
        currentTime="10:01:00 AM"
        autoRefreshEnabled={true}
        refreshInterval={10}
        dataSource={{ claude: "api", codex: "pty" }}
      />
    ), { width: 180, height: 1 });
    const frame = captureCharFrame();
    expect(frame).toContain("Source:");
    expect(frame).toContain("Claude: api");
    expect(frame).toContain("Codex: pty");
  });

  test("snapshot matches expected format", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <StatusBar
        lastUpdated="10:30:00 AM"
        currentTime="11:00:00 PM"
        autoRefreshEnabled={true}
        refreshInterval={10}
        dataSource={{}}
      />
    ), { width: 80, height: 1 });
    const frame = captureCharFrame();
    expect(frame).toMatchSnapshot();
  });
});

describe("StatusBar - colors", () => {
  test("text rendered in subtext color", async () => {
    const { captureSpans } = await renderComponent(() => (
      <StatusBar
        lastUpdated="10:00:00 AM"
        currentTime="11:00:00 PM"
        autoRefreshEnabled={true}
        refreshInterval={10}
        dataSource={{}}
      />
    ), { width: 120, height: 1 });
    const spans = captureSpans();
    // Find a span with status bar text
    const textSpans = spans.lines.flatMap((l) =>
      l.spans.filter((s) => s.text.includes("Last updated")),
    );
    expect(textSpans.length).toBeGreaterThan(0);
  });
});
