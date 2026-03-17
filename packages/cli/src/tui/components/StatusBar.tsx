/**
 * Status bar component showing last update time, refresh status, and warnings.
 */
import { Show } from "solid-js";
import { useTheme } from "../theme.js";
import { formatWarningCompact, type ServiceWarning } from "@lazyusage/core";

interface StatusBarProps {
  lastUpdated: string | null;
  currentTime: string;
  autoRefreshEnabled: boolean;
  refreshInterval: number;
  dataSource: Record<string, string>;
  warnings?: ServiceWarning[];
}

export function StatusBar(props: StatusBarProps) {
  const theme = useTheme();
  const SOURCE_DISPLAY: Record<string, string> = {
    api: "API",
    pty: "Terminal",
    cache: "Cached",
    fallback: "Offline",
  };

  const statusText = () => {
    const updated = props.lastUpdated ?? "Never";
    const refreshState = props.autoRefreshEnabled
      ? `ON (${props.refreshInterval}s)`
      : "OFF";

    const sources = Object.entries(props.dataSource)
      .map(([svc, src]) => `${svc[0].toUpperCase() + svc.slice(1)}: ${SOURCE_DISPLAY[src] ?? src}`)
      .join(" | ");

    const sourceStr = sources ? ` | Source: ${sources}` : "";
    return ` ${props.currentTime} | Last updated: ${updated} | Auto-refresh: ${refreshState}${sourceStr}`;
  };

  const warningText = () => {
    const w = props.warnings ?? [];
    if (w.length === 0) return null;
    return w.map((w) => formatWarningCompact(w)).join(" | ");
  };

  const barHeight = () => (warningText() ? 2 : 1);

  return (
    <box flexDirection="column" width="100%" height={barHeight()} flexShrink={0}>
      <Show when={warningText()}>
        <text
          content={` ! ${warningText()}`}
          fg={theme.yellow}
          height={1}
          width="100%"
          paddingLeft={1}
        />
      </Show>
      <text
        content={statusText()}
        fg={theme.subtext}
        height={1}
        width="100%"
        paddingLeft={1}
      />
    </box>
  );
}
