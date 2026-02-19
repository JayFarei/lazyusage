/**
 * usage-check command: Fast point-in-time usage snapshot.
 * Port of usage_check() from src/cli.py
 */
import { Command } from "commander";
import {
  createClaudeChain,
  createCodexChain,
  formatClaudeText,
  formatCodexText,
  formatAllText,
  formatCombinedJson,
  formatWithAvailability,
  UsageStore,
  type MetricsDict,
  type FallbackChain,
  type ServiceName,
} from "@lazyusage/core";

export function detectAvailableServices(): string[] {
  const available: string[] = [];
  if (Bun.which("claude")) available.push("claude");
  if (Bun.which("codex")) available.push("codex");
  return available;
}

function validateService(
  service: string | undefined,
  available: string[],
): string[] {
  if (!service) {
    if (available.length === 0) {
      console.error(
        "Error: No CLI tools found. Please install 'claude' or 'codex' CLI.",
      );
      process.exit(1);
    }
    return available;
  }

  if (service === "all") {
    if (available.length < 2) {
      const all = new Set(["claude", "codex"]);
      const missing = [...all].filter((s) => !available.includes(s));
      console.error(
        `Error: 'all' requested but ${missing.join(", ")} not available. Only ${available.join(", ")} found.`,
      );
      process.exit(1);
    }
    return ["claude", "codex"];
  }

  if (!available.includes(service)) {
    console.error(
      `Error: '${service}' CLI not found in PATH. Available: ${available.length > 0 ? available.join(", ") : "none"}`,
    );
    process.exit(1);
  }

  return [service];
}

async function collectMetrics(
  services: string[],
  debug: boolean,
  store: boolean = true,
): Promise<{ claudeMetrics: MetricsDict | null; codexMetrics: MetricsDict | null }> {
  let claudeMetrics: MetricsDict | null = null;
  let codexMetrics: MetricsDict | null = null;
  let claudeSource: string | null = null;
  let codexSource: string | null = null;

  if (services.includes("claude")) {
    if (debug) console.error("Collecting Claude metrics...");
    const chain = createClaudeChain(false) as FallbackChain;
    const result = await chain.fetch();
    claudeMetrics = result.metrics as MetricsDict | null;
    claudeSource = result.source;
    if (debug) {
      console.error(`  Source: ${result.source}`);
      if (result.stale) console.error("  Warning: Data is stale");
      if (result.error) console.error(`  Error: ${result.error}`);
    }
  }

  if (services.includes("codex")) {
    if (debug) console.error("Collecting Codex metrics...");
    const chain = createCodexChain(false) as FallbackChain;
    const result = await chain.fetch();
    codexMetrics = result.metrics as MetricsDict | null;
    codexSource = result.source;
    if (debug) {
      console.error(`  Source: ${result.source}`);
      if (result.stale) console.error("  Warning: Data is stale");
      if (result.error) console.error(`  Error: ${result.error}`);
    }
  }

  if (store) {
    storeSnapshots(claudeMetrics, codexMetrics, claudeSource, codexSource);
  }

  return { claudeMetrics, codexMetrics };
}

function storeSnapshots(
  claudeMetrics: MetricsDict | null,
  codexMetrics: MetricsDict | null,
  claudeSource: string | null,
  codexSource: string | null,
): void {
  try {
    const usageStore = new UsageStore();
    const collectionId = crypto.randomUUID();

    if (claudeMetrics && claudeSource) {
      usageStore.storeSnapshot("claude", claudeMetrics, claudeSource, collectionId);
    }
    if (codexMetrics && codexSource) {
      usageStore.storeSnapshot("codex", codexMetrics, codexSource, collectionId);
    }

    usageStore.close();
  } catch {
    // Silently fail, storage is best-effort
  }
}

export const usageCheckCommand = new Command("usage-check")
  .description("Fast point-in-time usage snapshot")
  .argument("[service]", "Service to check: claude, codex, or all")
  .option("--json", "Output as JSON")
  .option("--text", "Output as text (default)")
  .option("--debug", "Show execution timing and source info")
  .action(async (service: string | undefined, opts: { json?: boolean; text?: boolean; debug?: boolean }) => {
    const startTime = performance.now();
    const available = detectAvailableServices();
    const services = validateService(service, available);
    const { claudeMetrics, codexMetrics } = await collectMetrics(services, opts.debug ?? false);

    let output: string;
    if (opts.json) {
      output = formatCombinedJson(claudeMetrics, codexMetrics, available);
    } else {
      if (services.length === 1) {
        if (services.includes("claude") && claudeMetrics) {
          output = formatClaudeText(claudeMetrics);
        } else if (codexMetrics) {
          output = formatCodexText(codexMetrics);
        } else {
          output = formatWithAvailability(claudeMetrics, codexMetrics, available);
        }
      } else {
        output = formatWithAvailability(claudeMetrics, codexMetrics, available);
      }
    }

    console.log(output);

    if (opts.debug) {
      const elapsed = (performance.now() - startTime) / 1000;
      console.error(`\nExecution time: ${elapsed.toFixed(2)}s`);
    }
  });

export { collectMetrics, validateService };
