/**
 * Complete agentic capacity management loop.
 *
 * Combines all SKILL.md scenarios into one runnable demo:
 * pre-flight check, adaptive throttling, service failover,
 * and sleep-until-reset.
 *
 * Usage:
 *   bun run examples/agent_integration.ts
 */

import { $ } from "bun";

// -- types ------------------------------------------------------------------

interface Metric { name: string; remaining_pct: number; resets: string }
interface Service { name: string; available: boolean; metrics: Metric[] }
interface Snapshot { services: Service[] }

type Level = "green" | "yellow" | "red";

// -- helpers ----------------------------------------------------------------

async function getUsage(svc?: string): Promise<Snapshot> {
  const cmd = svc ? $`bun run lazyusage:dev ${svc} --json` : $`bun run lazyusage:dev --json`;
  return cmd.json();
}

function tightest(snap: Snapshot, svc?: string): Metric | null {
  const s = snap.services.find(
    (s) => s.available && (!svc || s.name === svc),
  );
  if (!s || s.metrics.length === 0) return null;
  return s.metrics.reduce((a, b) =>
    a.remaining_pct <= b.remaining_pct ? a : b,
  );
}

function level(remaining: number): Level {
  if (remaining >= 50) return "green";
  if (remaining >= 20) return "yellow";
  return "red";
}

function msUntilReset(resets: string): number {
  const now = new Date();
  const m = resets.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (m) {
    let h = parseInt(m[1]);
    if (m[3].toLowerCase() === "pm" && h !== 12) h += 12;
    if (m[3].toLowerCase() === "am" && h === 12) h = 0;
    const t = new Date(now);
    t.setHours(h, parseInt(m[2]), 0, 0);
    if (t <= now) t.setDate(t.getDate() + 1);
    return t.getTime() - now.getTime();
  }
  return 3_600_000;
}

function bestAlternative(snap: Snapshot, avoid: string): string | null {
  const alts = snap.services
    .filter((s) => s.available && s.name !== avoid)
    .map((s) => ({
      name: s.name,
      headroom: Math.min(...s.metrics.map((m) => m.remaining_pct)),
    }))
    .sort((a, b) => b.headroom - a.headroom);
  return alts.length > 0 && alts[0].headroom >= 20 ? alts[0].name : null;
}

// -- main loop --------------------------------------------------------------

const MAX_RETRIES = 3;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  console.log(`\n--- Attempt ${attempt} ---`);

  const snap = await getUsage();
  const metric = tightest(snap, "claude");

  if (!metric) {
    console.log("No services available.");
    process.exit(1);
  }

  const lv = level(metric.remaining_pct);
  console.log(`Tightest: ${metric.name} ${metric.remaining_pct}% [${lv}]`);

  if (lv === "green") {
    console.log("Full speed. Proceeding.");
    process.exit(0);
  }

  if (lv === "yellow") {
    console.log("Throttling: fewer agents, smaller context, cheaper model.");
    process.exit(0);
  }

  // red
  const alt = bestAlternative(snap, "claude");
  if (alt) {
    console.log(`Failing over to ${alt}.`);
    process.exit(0);
  }

  if (attempt < MAX_RETRIES) {
    const wait = msUntilReset(metric.resets) + 60_000;
    console.log(`Sleeping ${Math.ceil(wait / 60_000)} min until ${metric.resets}...`);
    await new Promise((r) => setTimeout(r, wait));
  } else {
    console.log("Max retries reached.");
    process.exit(1);
  }
}
