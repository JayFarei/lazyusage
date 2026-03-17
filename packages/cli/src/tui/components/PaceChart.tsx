/**
 * Sparkline chart showing hourly usage pace over time.
 * Uses Unicode block characters for a compact visualization.
 */
import { Show, createMemo } from "solid-js";
import { useTheme } from "../theme.js";
import type { PacePoint } from "@lazyusage/core/storage/pace";

const SPARK_CHARS = [" ", "\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

interface PaceChartProps {
  points: PacePoint[];
  width: number;
  label: string;
}

export function PaceChart(props: PaceChartProps) {
  const theme = useTheme();

  const sparkline = createMemo(() => {
    const pts = props.points;
    if (pts.length === 0) return "";

    // Downsample to fit width
    const w = Math.max(10, props.width);
    const step = Math.max(1, Math.floor(pts.length / w));
    const sampled: number[] = [];

    for (let i = 0; i < pts.length; i += step) {
      const slice = pts.slice(i, i + step);
      const avg = slice.reduce((s, p) => s + p.usedPct, 0) / slice.length;
      sampled.push(avg);
    }

    // Normalize to spark chars
    const max = Math.max(...sampled, 1);
    return sampled
      .map((v) => {
        const idx = Math.round((v / max) * (SPARK_CHARS.length - 1));
        return SPARK_CHARS[Math.min(idx, SPARK_CHARS.length - 1)];
      })
      .join("");
  });

  const summary = createMemo(() => {
    const pts = props.points;
    if (pts.length === 0) return "No data";
    const latest = pts[pts.length - 1].usedPct;
    const avg = Math.round(pts.reduce((s, p) => s + p.usedPct, 0) / pts.length);
    return `now: ${latest}%  avg: ${avg}%`;
  });

  return (
    <box flexDirection="column" width="100%">
      <text
        content={`  ${props.label}`}
        fg={theme.cyan}
        bold={true}
        height={1}
      />
      <Show when={props.points.length > 0} fallback={
        <text content="  No pace data available" fg={theme.subtext} height={1} />
      }>
        <text content={`  ${sparkline()}`} fg={theme.green} height={1} />
        <text content={`  ${summary()}`} fg={theme.subtext} height={1} />
      </Show>
    </box>
  );
}
