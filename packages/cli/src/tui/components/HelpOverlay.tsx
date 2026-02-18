/**
 * Help overlay showing keyboard shortcuts.
 */
import { Show } from "solid-js";
import { useTheme } from "../theme.js";

interface HelpOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export function HelpOverlay(props: HelpOverlayProps) {
  const theme = useTheme();
  const helpText = [
    "Keyboard Shortcuts",
    "==================",
    "",
    "  1/2        Focus service bars panel",
    "  3/4        Focus stats panel",
    "  j/k        Navigate metrics (up/down)",
    "  Tab        Switch focus (bars \u2194 stats)",
    "  g          Fullscreen focused panel",
    "  Escape     Close fullscreen",
    "  [/]        Switch tab (Daily/Weekly/Monthly)",
    "  r          Refresh data now",
    "  p          Pause/Resume auto-refresh",
    "  +/=        Speed up refresh (min 5s)",
    "  -/_        Slow down refresh (max 60s)",
    "  ?          Toggle this help overlay",
    "  q          Quit",
    "",
    "  Mouse wheel scrolls content in tabs",
    "",
    "Press any key to close",
  ].join("\n");

  return (
    <Show when={props.visible}>
      <box
        position="absolute"
        top={2}
        left={5}
        width={55}
        height={23}
        backgroundColor={theme.surface0}
        borderColor={theme.cyan}
        borderStyle={"rounded" as any}
        padding={1}
      >
        <text content={helpText} fg={theme.text} />
      </box>
    </Show>
  );
}
