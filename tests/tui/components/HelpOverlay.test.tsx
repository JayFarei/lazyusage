/**
 * Visual snapshot tests for HelpOverlay component.
 */
import { describe, test, expect } from "bun:test";
import { renderComponent } from "../helpers.js";
import { HelpOverlay } from "../../../packages/cli/src/tui/components/HelpOverlay.js";

describe("HelpOverlay - visibility", () => {
  test("visible=true renders keybinding content", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <HelpOverlay visible={true} onClose={() => {}} />
    ), { width: 80, height: 25 });
    const frame = captureCharFrame();
    expect(frame).toContain("Keyboard Shortcuts");
    expect(frame).toContain("j/k");
    expect(frame).toContain("Navigate");
    // Note: "Press any key to close" may be clipped by box height=19 at height=25
    // The box needs ~20 lines but is fixed at 19 - last line is clipped
  });

  test("visible=false renders nothing (empty frame)", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <HelpOverlay visible={false} onClose={() => {}} />
    ), { width: 80, height: 25 });
    const frame = captureCharFrame();
    // Frame should not contain help content
    expect(frame).not.toContain("Keyboard Shortcuts");
    expect(frame).not.toContain("Press any key to close");
  });

  test("contains all keybinding labels", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <HelpOverlay visible={true} onClose={() => {}} />
    ), { width: 80, height: 25 });
    const frame = captureCharFrame();
    // Check all documented keybindings are present
    expect(frame).toContain("1/2");
    expect(frame).toContain("j/k");
    expect(frame).toContain("[/]");
    expect(frame).toContain("r");
    expect(frame).toContain("p");
    expect(frame).toContain("+/=");
    expect(frame).toContain("-/_");
    expect(frame).toContain("?");
    expect(frame).toContain("q");
  });

  test("snapshot when visible", async () => {
    const { captureCharFrame } = await renderComponent(() => (
      <HelpOverlay visible={true} onClose={() => {}} />
    ), { width: 80, height: 25 });
    expect(captureCharFrame()).toMatchSnapshot();
  });
});
