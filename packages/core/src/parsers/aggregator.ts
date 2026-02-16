/**
 * Aggregate SessionTokens into per-project usage summaries.
 * Three time windows: daily (today), weekly (7 days), monthly (28 days).
 */
import type { SessionTokens, ProjectUsage } from "./types.js";

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupByProject(sessions: SessionTokens[]): ProjectUsage[] {
  const map = new Map<string, { inputTokens: number; outputTokens: number; totalTokens: number }>();

  for (const s of sessions) {
    const existing = map.get(s.project);
    if (existing) {
      existing.inputTokens += s.inputTokens;
      existing.outputTokens += s.outputTokens;
      existing.totalTokens += s.totalTokens;
    } else {
      map.set(s.project, {
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        totalTokens: s.totalTokens,
      });
    }
  }

  const grandTotal = sessions.reduce((sum, s) => sum + s.totalTokens, 0);

  const result: ProjectUsage[] = [];
  for (const [project, data] of map) {
    result.push({
      project,
      totalTokens: data.totalTokens,
      pctOfTotal: grandTotal > 0 ? (data.totalTokens / grandTotal) * 100 : 0,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
    });
  }

  return result.sort((a, b) => b.totalTokens - a.totalTokens);
}

export function aggregateDaily(sessions: SessionTokens[]): ProjectUsage[] {
  const today = todayStr();
  return groupByProject(sessions.filter((s) => s.date === today));
}

export function aggregateWeekly(sessions: SessionTokens[]): ProjectUsage[] {
  const cutoff = daysAgoStr(7);
  return groupByProject(sessions.filter((s) => s.date >= cutoff));
}

export function aggregateMonthly(sessions: SessionTokens[]): ProjectUsage[] {
  const cutoff = daysAgoStr(28);
  return groupByProject(sessions.filter((s) => s.date >= cutoff));
}
