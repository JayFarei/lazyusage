/**
 * Snapshot-backed pace data for daemon graph views.
 * Shapes the current window history and prediction envelope for rendering.
 */
import { SESSION_WINDOW_HOURS, WEEKLY_WINDOW_HOURS } from "../constants.js";
import type { MetricData, ServiceName } from "../types.js";
import { parseTimeToDatetime } from "../utils/time.js";
import type { UsageStore } from "./database.js";

export interface PacePoint {
  hour: number;
  timestampMs: number;
  usedPct: number;
  sampleCount: number;
}

export interface PaceData {
  service: ServiceName;
  metricKey: string;
  points: PacePoint[];
  windowStartMs: number;
  windowEndMs: number;
  nowMs: number;
  currentUsedPct: number | null;
  projectedTotalPct: number | null;
  yMaxPct: number;
}

export interface PaceBuildOptions {
  currentMetric?: MetricData | null;
  projectedTotalPct?: number | null;
  nowMs?: number;
}

const WINDOW_HOURS_BY_METRIC: Record<string, number> = {
  session: SESSION_WINDOW_HOURS,
  "5h": SESSION_WINDOW_HOURS,
  week_all: WEEKLY_WINDOW_HOURS,
  week_sonnet: WEEKLY_WINDOW_HOURS,
  weekly: WEEKLY_WINDOW_HOURS,
};

function roundGraphCeiling(value: number): number {
  if (value <= 100) {
    return 100;
  }

  return Math.ceil(value / 10) * 10;
}

function inferProjectedTotalPct(
  currentUsedPct: number | null,
  windowStartMs: number,
  windowEndMs: number,
  nowMs: number,
): number | null {
  if (currentUsedPct == null || currentUsedPct <= 0) {
    return null;
  }

  const elapsedRatio = Math.max(0.01, Math.min(1, (nowMs - windowStartMs) / Math.max(1, windowEndMs - windowStartMs)));

  return currentUsedPct / elapsedRatio;
}

export function getWindowHoursForMetric(metricKey: string): number {
  return WINDOW_HOURS_BY_METRIC[metricKey] ?? WEEKLY_WINDOW_HOURS;
}

export function buildPaceData(
  store: Pick<UsageStore, "getHistory">,
  service: ServiceName,
  metricKey: string,
  options: PaceBuildOptions = {},
): PaceData {
  const nowMs = options.nowMs ?? Date.now();
  const windowHours = getWindowHoursForMetric(metricKey);
  const currentMetric = options.currentMetric ?? null;

  let windowEndMs = nowMs;
  if (currentMetric?.resets) {
    try {
      windowEndMs = parseTimeToDatetime(currentMetric.resets).getTime();
    } catch {
      windowEndMs = nowMs;
    }
  }

  const windowStartMs = windowEndMs - windowHours * 3600_000;
  const points = store
    .getHistory(service, metricKey, windowHours)
    .map((entry) => ({
      hour: Math.floor(new Date(entry.timestamp).getTime() / 1000),
      timestampMs: new Date(entry.timestamp).getTime(),
      usedPct: entry.used_pct,
      sampleCount: 1,
    }))
    .filter(
      (point) =>
        Number.isFinite(point.timestampMs) && point.timestampMs >= windowStartMs && point.timestampMs <= windowEndMs,
    )
    .sort((left, right) => left.timestampMs - right.timestampMs);

  const clampedNowMs = Math.min(Math.max(nowMs, windowStartMs), windowEndMs);
  const currentUsedPct = currentMetric?.used_pct ?? points.at(-1)?.usedPct ?? null;
  const latestPoint = points.at(-1);

  if (
    currentUsedPct != null &&
    (!latestPoint ||
      Math.abs(latestPoint.timestampMs - clampedNowMs) > 120_000 ||
      latestPoint.usedPct !== currentUsedPct)
  ) {
    points.push({
      hour: Math.floor(clampedNowMs / 1000),
      timestampMs: clampedNowMs,
      usedPct: currentUsedPct,
      sampleCount: 1,
    });
  }

  points.sort((left, right) => left.timestampMs - right.timestampMs);

  const projectedTotalPct =
    options.projectedTotalPct ?? inferProjectedTotalPct(currentUsedPct, windowStartMs, windowEndMs, clampedNowMs);
  const yMaxPct = roundGraphCeiling(
    Math.max(100, currentUsedPct ?? 0, projectedTotalPct ?? 0, ...points.map((point) => point.usedPct)),
  );

  return {
    service,
    metricKey,
    points,
    windowStartMs,
    windowEndMs,
    nowMs: clampedNowMs,
    currentUsedPct,
    projectedTotalPct,
    yMaxPct,
  };
}
