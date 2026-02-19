export interface MetricData {
  used_pct: number;
  remaining_pct: number;
  resets: string;
}

export interface ServiceMetric extends MetricData {
  name: string;
}

export interface ServiceSnapshot {
  name: string;
  available: boolean;
  subscription_type: string | null;
  metrics: ServiceMetric[];
}

export interface UsageSnapshot {
  timestamp: string;
  available_services: string[];
  services: ServiceSnapshot[];
}
