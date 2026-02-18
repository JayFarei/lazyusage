/**
 * Example: Agent capacity check before spawning a sub-agent.
 *
 * Demonstrates how an AI agent can check capacity before spawning
 * a sub-agent to avoid hitting rate limits.
 *
 * Usage:
 *   bun run examples/agent_integration.ts
 */

import { $ } from "bun";

interface MetricResult {
  name: string;
  remaining_pct: number;
}

interface ServiceResult {
  name: string;
  available: boolean;
  metrics: MetricResult[];
}

interface UsageJson {
  services: ServiceResult[];
}

/**
 * Check remaining capacity for a service.
 * Returns {hasCapacity, message}.
 */
async function checkCapacity(
  service = "claude",
  threshold = 20,
): Promise<{ hasCapacity: boolean; message: string }> {
  try {
    const output = await $`bun run usage ${service} --json`.text();
    const data: UsageJson = JSON.parse(output);

    for (const svc of data.services) {
      if (!svc.available) continue;
      for (const metric of svc.metrics) {
        if (metric.remaining_pct < threshold) {
          return {
            hasCapacity: false,
            message:
              `${svc.name} low capacity: ${metric.name} only ${metric.remaining_pct}% remaining`,
          };
        }
      }
    }

    return { hasCapacity: true, message: "Capacity available" };
  } catch (err) {
    return { hasCapacity: false, message: `Error: ${err}` };
  }
}

/**
 * Get the most restrictive (lowest remaining) metric for a service.
 * Returns null if the service is unavailable or an error occurs.
 */
async function getMostRestrictiveMetric(
  service = "claude",
): Promise<{ name: string; remaining_pct: number } | null> {
  try {
    const output = await $`bun run usage ${service} --json`.text();
    const data: UsageJson = JSON.parse(output);

    for (const svc of data.services) {
      if (svc.name === service && svc.available) {
        const min = svc.metrics.reduce((a, b) =>
          a.remaining_pct <= b.remaining_pct ? a : b,
        );
        return { name: min.name, remaining_pct: min.remaining_pct };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// Example usage: check Claude capacity before spawning sub-agent
console.log("Checking Claude capacity...");

const metric = await getMostRestrictiveMetric("claude");
if (!metric) {
  console.error("Error checking capacity");
  process.exit(1);
}

console.log(`Most restrictive metric: ${metric.name} (${metric.remaining_pct}% remaining)`);

const { hasCapacity, message } = await checkCapacity("claude", 20);
if (hasCapacity) {
  console.log(`✓ ${message}`);
  console.log("Spawning sub-agent...");
  // spawnSubAgent();
  process.exit(0);
} else {
  console.log(`✗ ${message}`);
  console.log("Deferring sub-agent spawn");
  process.exit(1);
}
