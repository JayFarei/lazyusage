import type { ServiceSnapshot } from "../types";
import { MetricBar } from "./MetricBar";

interface Props {
  service: ServiceSnapshot;
}

export function ServiceCard({ service }: Props) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold capitalize">{service.name}</h2>
        <div className="flex items-center gap-2">
          {service.subscription_type && (
            <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">
              {service.subscription_type}
            </span>
          )}
          <span className={`inline-block w-2 h-2 rounded-full ${service.available ? "bg-green-400" : "bg-red-400"}`} />
        </div>
      </div>
      {service.metrics.length === 0 ? (
        <p className="text-sm text-gray-500">No metrics available</p>
      ) : (
        service.metrics.map((m) => <MetricBar key={m.name} metric={m} />)
      )}
    </div>
  );
}
