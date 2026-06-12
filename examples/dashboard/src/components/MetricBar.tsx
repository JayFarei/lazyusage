import type { ServiceMetric } from "../types";

interface Props {
  metric: ServiceMetric;
}

function barColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-400";
  return "bg-green-500";
}

export function MetricBar({ metric }: Props) {
  const pct = Math.min(100, Math.max(0, metric.used_pct));
  const color = barColor(pct);

  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span className="capitalize">{metric.name}</span>
        <span>{pct.toFixed(1)}% used</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-gray-500 mt-1">Resets: {metric.resets}</div>
    </div>
  );
}
