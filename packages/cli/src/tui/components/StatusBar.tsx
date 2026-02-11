/**
 * Status bar component showing last update time and refresh status.
 */
import { theme } from "../theme.js";

interface StatusBarProps {
  lastUpdated: string | null;
  currentTime: string;
  autoRefreshEnabled: boolean;
  refreshInterval: number;
  dataSource: Record<string, string>;
}

export function StatusBar(props: StatusBarProps) {
  const statusText = () => {
    const updated = props.lastUpdated ?? "Never";
    const refreshState = props.autoRefreshEnabled
      ? `ON (${props.refreshInterval}s)`
      : "OFF";

    const sources = Object.entries(props.dataSource)
      .map(([svc, src]) => `${svc[0].toUpperCase() + svc.slice(1)}: ${src}`)
      .join(" | ");

    const sourceStr = sources ? ` | Source: ${sources}` : "";
    return ` ${props.currentTime} | Last updated: ${updated} | Auto-refresh: ${refreshState}${sourceStr}`;
  };

  return (
    <text
      content={statusText()}
      fg={theme.subtext}
      height={1}
      width="100%"
      paddingLeft={1}
    />
  );
}
