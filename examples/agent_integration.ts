/**
 * Complete agentic capacity-management loop.
 *
 * By default this uses an installed `lazyusage` binary. Override with
 * LAZYUSAGE_CMD for repo-local development, for example:
 *
 *   LAZYUSAGE_CMD="bun run lazyusage" bun run examples/agent_integration.ts
 */

interface Metric {
  name: string;
  remaining_pct: number;
  resets: string;
}

interface Service {
  name: string;
  available: boolean;
  source: string | null;
  stale: boolean;
  error: string | null;
  metrics: Metric[];
}

interface Snapshot {
  services: Service[];
}

type Level = "green" | "yellow" | "red";

const CLI = process.env.LAZYUSAGE_CMD ?? "lazyusage";

async function runJson(command: string): Promise<Snapshot> {
  const proc = Bun.spawn(["/bin/sh", "-lc", command], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `Command failed: ${command}`);
  }

  return JSON.parse(stdout) as Snapshot;
}

async function getUsage(svc?: string): Promise<Snapshot> {
  const command = svc ? `${CLI} ${svc} --json` : `${CLI} --json`;
  return runJson(command);
}

function tightest(snap: Snapshot, svc?: string): Metric | null {
  const service = snap.services.find((entry) => entry.available && (!svc || entry.name === svc));
  if (!service || service.metrics.length === 0) return null;
  return service.metrics.reduce((a, b) => (a.remaining_pct <= b.remaining_pct ? a : b));
}

function level(remaining: number): Level {
  if (remaining >= 50) return "green";
  if (remaining >= 20) return "yellow";
  return "red";
}

function shouldTrust(service: Service | undefined): boolean {
  return !!service && service.source !== "fallback" && !service.stale;
}

function msUntilReset(resets: string): number {
  const now = new Date();
  const short = resets.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
  if (short) {
    let hour = parseInt(short[1], 10);
    if (short[3].toLowerCase() === "pm" && hour !== 12) hour += 12;
    if (short[3].toLowerCase() === "am" && hour === 12) hour = 0;
    const target = new Date(now);
    target.setHours(hour, parseInt(short[2], 10), 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    return target.getTime() - now.getTime();
  }
  return 3_600_000;
}

function bestAlternative(snap: Snapshot, avoid: string): string | null {
  const alternatives = snap.services
    .filter((service) => service.available && service.name !== avoid && shouldTrust(service))
    .map((service) => ({
      name: service.name,
      headroom: Math.min(...service.metrics.map((metric) => metric.remaining_pct)),
    }))
    .sort((a, b) => b.headroom - a.headroom);

  return alternatives.length > 0 && alternatives[0].headroom >= 20 ? alternatives[0].name : null;
}

const MAX_RETRIES = 3;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  console.log(`\n--- Attempt ${attempt} ---`);

  const snapshot = await getUsage();
  const service = snapshot.services.find((entry) => entry.name === "claude");
  const metric = tightest(snapshot, "claude");

  if (!metric || !service) {
    console.log("Claude is not available.");
    process.exit(1);
  }

  console.log(`Source: ${service.source ?? "unknown"}${service.stale ? " (stale)" : ""}`);
  if (service.error) console.log(`Fetch warning: ${service.error}`);

  if (!shouldTrust(service)) {
    const alternative = bestAlternative(snapshot, "claude");
    if (alternative) {
      console.log(`Claude data is degraded. Failing over to ${alternative}.`);
      process.exit(0);
    }
  }

  const currentLevel = level(metric.remaining_pct);
  console.log(`Tightest: ${metric.name} ${metric.remaining_pct}% [${currentLevel}]`);

  if (currentLevel === "green") {
    console.log("Full speed. Proceeding.");
    process.exit(0);
  }

  if (currentLevel === "yellow") {
    console.log("Throttling: fewer agents, smaller context, cheaper model.");
    process.exit(0);
  }

  const alternative = bestAlternative(snapshot, "claude");
  if (alternative) {
    console.log(`Failing over to ${alternative}.`);
    process.exit(0);
  }

  if (attempt < MAX_RETRIES) {
    const wait = msUntilReset(metric.resets) + 60_000;
    console.log(`Sleeping ${Math.ceil(wait / 60_000)} min until ${metric.resets}...`);
    await Bun.sleep(wait);
  } else {
    console.log("Max retries reached.");
    process.exit(1);
  }
}
