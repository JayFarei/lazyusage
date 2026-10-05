/**
 * usage-check command: Fast point-in-time usage snapshot.
 * Port of usage_check() from src/cli.py
 */

import { Command } from "commander";
import {
  createChain,
  detectWarning,
  ExitCode,
  type FallbackChain,
  formatCombinedJson,
  formatServiceText,
  formatWarningStderr,
  formatWithAvailability,
  isServiceName,
  type MetricsDict,
  SERVICE_NAMES,
  SERVICES,
  type ServiceMetricsMap,
  type ServiceName,
  type ServiceResourceInfo,
  UsageStore,
} from "lazyusage-core";

export function detectAvailableServices(): ServiceName[] {
  return SERVICE_NAMES.filter((service) => Bun.which(SERVICES[service].binary));
}

function validateService(service: string | undefined, available: ServiceName[]): ServiceName[] {
  if (!service || service === "all") {
    if (available.length === 0) {
      const binaries = SERVICE_NAMES.map((s) => `'${SERVICES[s].binary}'`).join(", ");
      console.error(`Error: No CLI tools found. Please install one of: ${binaries}.`);
      process.exit(ExitCode.BINARY_NOT_FOUND);
    }
    return available;
  }

  if (!isServiceName(service)) {
    console.error(`Error: Unknown service '${service}'. Expected one of: ${[...SERVICE_NAMES, "all"].join(", ")}`);
    process.exit(ExitCode.FAILURE);
  }

  if (!available.includes(service)) {
    console.error(
      `Error: '${service}' CLI not found in PATH. Available: ${available.length > 0 ? available.join(", ") : "none"}`,
    );
    process.exit(ExitCode.BINARY_NOT_FOUND);
  }

  return [service];
}

async function collectMetrics(
  services: ServiceName[],
  debug: boolean,
  store: boolean = true,
): Promise<{
  metrics: ServiceMetricsMap;
  sources: Record<string, string>;
  serviceInfo: Partial<Record<ServiceName, ServiceResourceInfo>>;
}> {
  const metrics: ServiceMetricsMap = {};
  const sources: Record<string, string> = {};
  const serviceInfo: Partial<Record<ServiceName, ServiceResourceInfo>> = {};

  for (const service of services) {
    if (debug) console.error(`Collecting ${SERVICES[service].label} metrics...`);
    const chain = createChain(service, false) as FallbackChain;
    const result = await chain.fetch();
    metrics[service] = result.metrics as MetricsDict | null;
    if (result.source) sources[service] = result.source;
    serviceInfo[service] = {
      source: result.source,
      stale: result.stale,
      error: result.error,
    };
    if (debug) {
      console.error(`  Source: ${result.source}`);
      if (result.stale) console.error("  Warning: Data is stale");
      if (result.error) console.error(`  Error: ${result.error}`);
    }
    const warning = detectWarning(service, result);
    if (warning) console.error(formatWarningStderr(warning));
  }

  if (store) {
    storeSnapshots(metrics, sources);
  }

  return { metrics, sources, serviceInfo };
}

function storeSnapshots(metrics: ServiceMetricsMap, sources: Record<string, string>): void {
  try {
    const usageStore = new UsageStore();
    const collectionId = crypto.randomUUID();

    for (const service of SERVICE_NAMES) {
      const serviceMetrics = metrics[service];
      const source = sources[service];
      if (serviceMetrics && source) {
        usageStore.storeSnapshot(service, serviceMetrics, source, collectionId);
      }
    }

    usageStore.close();
  } catch {
    // Silently fail, storage is best-effort
  }
}

/** Text for `--text`: a bare line for a single service, otherwise one labelled line per service. */
function formatTextOutput(services: ServiceName[], metrics: ServiceMetricsMap, available: ServiceName[]): string {
  const single = services.length === 1 ? services[0] : undefined;
  const singleMetrics = single ? metrics[single] : null;
  if (single && singleMetrics) return formatServiceText(single, singleMetrics);
  return formatWithAvailability(metrics, available);
}

export const usageCheckCommand = new Command("usage-check")
  .description("Fast point-in-time usage snapshot")
  .argument("[service]", "Service to check: claude, codex, grok, or all")
  .option("--json", "Output as JSON")
  .option("--json-only", "JSON output with errors as JSON on stdout (machine-safe)")
  .option("--text", "Output as text (default)")
  .option("--debug", "Show execution timing and source info")
  .action(
    async (
      service: string | undefined,
      opts: {
        json?: boolean;
        jsonOnly?: boolean;
        text?: boolean;
        debug?: boolean;
      },
    ) => {
      const jsonOnly = opts.jsonOnly ?? false;

      if (jsonOnly) {
        const origError = console.error;
        console.error = () => {};
        try {
          const startTime = performance.now();
          const available = detectAvailableServices();
          const services = validateService(service, available);
          const { metrics, sources, serviceInfo } = await collectMetrics(services, opts.debug ?? false);

          const output = formatCombinedJson(metrics, available, sources, serviceInfo);
          console.log(output);

          if (opts.debug) {
            console.error = origError;
            const elapsed = (performance.now() - startTime) / 1000;
            console.error(`\nExecution time: ${elapsed.toFixed(2)}s`);
          }
        } catch (e) {
          console.error = origError;
          console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
          process.exit(ExitCode.FAILURE);
        } finally {
          console.error = origError;
        }
        return;
      }

      const startTime = performance.now();
      const available = detectAvailableServices();
      const services = validateService(service, available);
      const { metrics, sources, serviceInfo } = await collectMetrics(services, opts.debug ?? false);

      const output = opts.json
        ? formatCombinedJson(metrics, available, sources, serviceInfo)
        : formatTextOutput(services, metrics, available);

      console.log(output);

      if (opts.debug) {
        const elapsed = (performance.now() - startTime) / 1000;
        console.error(`\nExecution time: ${elapsed.toFixed(2)}s`);
      }
    },
  );

export { collectMetrics, formatTextOutput, validateService };
