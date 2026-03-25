/**
 * usage command: Interactive TUI or continuous monitoring.
 * Port of usage() from src/cli.py
 */
import { Command } from "commander";
import {
  formatClaudeText,
  formatCodexText,
  formatCombinedJson,
  formatWithAvailability,
  formatClaudeCapacityText,
  formatCodexCapacityText,
  formatCapacityWithAvailability,
  formatCombinedCapacityJson,
  formatPredictionText,
  ExitCode,
  setLogLevel,
  UsageStore,
  computeDailyDeltas,
  predict,
  WEEKLY_WINDOW_HOURS,
  type LogLevel,
  type CapacityPrediction,
  type ServiceName,
  type MetricsDict,
} from "@lazyusage/core";
import { detectAvailableServices, validateService, collectMetrics } from "./usage-check.js";

/** Run predictions and return camelCase CapacityPrediction objects keyed by service → metric. */
function runPredictionsRaw(
  services: string[],
  claudeMetrics: MetricsDict | null,
  codexMetrics: MetricsDict | null,
): Record<string, Record<string, CapacityPrediction>> {
  const store = new UsageStore();
  const predictions: Record<string, Record<string, CapacityPrediction>> = {};

  try {
    const metricMap: Record<string, { metrics: MetricsDict | null; keys: string[] }> = {
      claude: { metrics: claudeMetrics, keys: ["week_all", "week_sonnet"] },
      codex: { metrics: codexMetrics, keys: ["weekly"] },
    };

    for (const svc of services) {
      const info = metricMap[svc];
      if (!info?.metrics) continue;

      const svcPredictions: Record<string, CapacityPrediction> = {};
      for (const metricName of info.keys) {
        const metricData = info.metrics[metricName];
        if (!metricData || typeof metricData !== "object" || !("used_pct" in metricData)) continue;

        const boundaries = store.getDailyBoundaries(svc as ServiceName, metricName, 30);
        const deltas = computeDailyDeltas(boundaries);

        const lastBoundary = boundaries[boundaries.length - 1];
        const windowEnds = lastBoundary?.resetsAt ?? new Date(Date.now() + WEEKLY_WINDOW_HOURS * 3600_000).toISOString();
        const remainingDays = Math.max(0, (new Date(windowEnds).getTime() - Date.now()) / (24 * 3600_000));
        const marks = store.getCapacityMarks();

        svcPredictions[metricName] = predict(
          deltas,
          (metricData as { used_pct: number }).used_pct,
          remainingDays,
          windowEnds,
          svc,
          metricName,
          marks,
        );
      }

      if (Object.keys(svcPredictions).length > 0) {
        predictions[svc] = svcPredictions;
      }
    }
  } finally {
    store.close();
  }

  return predictions;
}

/** Convert camelCase predictions to snake_case for JSON output. */
function predictionsToJson(
  raw: Record<string, Record<string, CapacityPrediction>>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [svc, metrics] of Object.entries(raw)) {
    const svcResult: Record<string, unknown> = {};
    for (const [metric, pred] of Object.entries(metrics)) {
      svcResult[metric] = {
        predicted_spare: pred.predictedSpare,
        over_budget: pred.overBudget,
        projected_total: pred.projectedTotal,
        average_rate: pred.averageRate,
        remaining_days: pred.remainingDays,
        used_so_far: pred.usedSoFar,
        source: pred.source,
        confidence: pred.confidence,
        sample_days: pred.sampleDays,
        window_ends: pred.windowEnds,
      };
    }
    result[svc] = svcResult;
  }
  return result;
}

const GROUPED_HELP = `
Human Options:
  --live              Enable continuous NDJSON stream (use with --json)
  --refresh <seconds> Refresh interval in seconds (default: 10, min: 5)

Agent Options:
  --text              Text output, single refresh
  --json              JSON output instead of TUI
  --json-only         JSON output with errors as JSON on stdout (machine-safe)
  --capacity          Filter output to capacity_remaining only (use with --text or --json)
  --predict           Show predicted spare capacity at window end
  --debug             Show debug information
  --verbose           Enable verbose output (same as --log-level debug)
  --log-level <level> Log level: error, warning, info, debug, trace

Software Integration:
  --serve             Start HTTP server (polling + streaming endpoints)
  --port <number>     Server port (default: 8080, requires --serve)
  --host <address>    Server bind address (default: 127.0.0.1, requires --serve)

Other:
  -h, --help          display help for command

Modes:
  usage                               Launch TUI (default)
  usage --text                        Quick text snapshot
  usage --json                        Single JSON snapshot to stdout
  usage --json --live                 Continuous NDJSON stream to stdout
  usage --json-only                   Machine-safe JSON (errors as JSON)
  usage --capacity                    Capacity-only text (most compact)
  usage --capacity --text             Same as --capacity alone
  usage --capacity --json             Capacity-only JSON snapshot
  usage --capacity --json --live      Capacity-only NDJSON stream
  usage --serve                       Start HTTP server on port 8080
  usage --serve --port 3000           Server on custom port`;

export const usageCommand = new Command("usage")
  .description("Interactive TUI or continuous monitoring")
  .argument("[service]", "Service to monitor: claude, codex, or all")
  .option("--live", "Enable continuous NDJSON stream (use with --json)")
  .option("--json", "JSON output instead of TUI")
  .option("--json-only", "JSON output with errors as JSON on stdout (machine-safe)")
  .option("--text", "Text output, single refresh")
  .option("--capacity", "Filter output to capacity_remaining only (use with --text or --json)")
  .option("--refresh <seconds>", "Refresh interval in seconds (default: 10, min: 5)", "10")
  .option("--debug", "Show debug information")
  .option("--verbose", "Enable verbose output (same as --log-level debug)")
  .option("--log-level <level>", "Log level: error, warning, info, debug, trace")
  .option("--predict", "Show predicted spare capacity at window end")
  .option("--serve", "Start HTTP server (polling + streaming endpoints)")
  .option("--port <number>", "Server port (default: 8080, requires --serve)", "8080")
  .option("--host <address>", "Server bind address (default: 127.0.0.1, use 0.0.0.0 for all interfaces)", "127.0.0.1")
  .configureHelp({
    formatHelp(cmd, helper) {
      const usage = helper.commandUsage(cmd);
      const description = helper.commandDescription(cmd);

      let output = "";
      if (usage) output += `Usage: ${usage}\n\n`;
      if (description) output += `${description}\n\n`;
      output += `Arguments:\n  service              Service to monitor: claude, codex, or all\n`;
      output += GROUPED_HELP;
      return output;
    },
  })
  .action(async (
    service: string | undefined,
    opts: {
      live?: boolean;
      json?: boolean;
      jsonOnly?: boolean;
      text?: boolean;
      capacity?: boolean;
      refresh?: string;
      debug?: boolean;
      verbose?: boolean;
      logLevel?: string;
      predict?: boolean;
      serve?: boolean;
      port?: string;
      host?: string;
    },
  ) => {
    // Configure logging
    if (opts.logLevel) {
      setLogLevel(opts.logLevel as LogLevel);
    } else if (opts.verbose || opts.debug) {
      setLogLevel("debug");
    }

    const jsonOnly = opts.jsonOnly ?? false;

    // When jsonOnly is set, suppress stderr and wrap in try-catch
    if (jsonOnly) {
      const origError = console.error;
      console.error = () => {};
      try {
        const available = detectAvailableServices();
        const services = validateService(service, available);
        const debug = opts.debug ?? false;

        // --json-only with --capacity
        if (opts.capacity) {
          const { claudeMetrics, codexMetrics, sources, serviceInfo } = await collectMetrics(services, debug);
          console.log(formatCombinedCapacityJson(claudeMetrics, codexMetrics, available, sources, serviceInfo));
          return;
        }

        const { claudeMetrics, codexMetrics, sources, serviceInfo } = await collectMetrics(services, debug);
        console.log(formatCombinedJson(claudeMetrics, codexMetrics, available, sources, serviceInfo));
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
    const refresh = Math.max(5, parseInt(opts.refresh ?? "10", 10) || 10);
    const debug = opts.debug ?? false;
    const port = parseInt(opts.port ?? "8080", 10) || 8080;
    const useJson = opts.json || jsonOnly;

    // Validate flag conflicts
    if (opts.serve && opts.text) {
      console.error("Error: --serve and --text are mutually exclusive.");
      process.exit(ExitCode.FAILURE);
    }
    if (opts.serve && opts.live) {
      console.error("Error: --serve and --live are mutually exclusive (server has its own streaming).");
      process.exit(ExitCode.FAILURE);
    }
    if (opts.serve && opts.json) {
      console.error("Error: --serve and --json are mutually exclusive (server already outputs JSON).");
      process.exit(ExitCode.FAILURE);
    }
    if (opts.serve && opts.capacity) {
      console.error("Error: --serve and --capacity are mutually exclusive.");
      process.exit(ExitCode.FAILURE);
    }
    if (opts.predict && opts.serve) {
      console.error("Error: --predict and --serve are mutually exclusive.");
      process.exit(ExitCode.FAILURE);
    }
    if (opts.port !== "8080" && !opts.serve) {
      console.error("Error: --port requires --serve.");
      process.exit(ExitCode.FAILURE);
    }
    if (opts.host !== "127.0.0.1" && !opts.serve) {
      console.error("Error: --host requires --serve.");
      process.exit(ExitCode.FAILURE);
    }

    // Route to appropriate mode
    if (opts.serve) {
      const { startServer } = await import("../server/index.js");
      startServer({ services, port, host: opts.host, refreshInterval: refresh, debug });
      return;
    }

    // --capacity --json --live: capacity NDJSON stream
    if (opts.capacity && useJson && opts.live) {
      const abortController = new AbortController();
      process.on("SIGINT", () => abortController.abort());

      while (!abortController.signal.aborted) {
        const loopStart = performance.now();
        const { claudeMetrics, codexMetrics, sources, serviceInfo } = await collectMetrics(services, debug, false);
        const output = formatCombinedCapacityJson(claudeMetrics, codexMetrics, available, sources, serviceInfo);
        console.log(JSON.stringify(JSON.parse(output)));
        const elapsed = (performance.now() - loopStart) / 1000;
        await Bun.sleep(Math.max(0, refresh - elapsed) * 1000);
      }
      return;
    }

    // --capacity --json: capacity JSON snapshot
    if (opts.capacity && useJson) {
      const { claudeMetrics, codexMetrics, sources, serviceInfo } = await collectMetrics(services, debug);
      const rawPreds = opts.predict ? runPredictionsRaw(services, claudeMetrics, codexMetrics) : undefined;
      const predictions = rawPreds ? predictionsToJson(rawPreds) : undefined;
      console.log(formatCombinedCapacityJson(claudeMetrics, codexMetrics, available, sources, serviceInfo, predictions));
      return;
    }

    // --capacity (with or without --text): capacity text - most compact agent output
    if (opts.capacity) {
      const { claudeMetrics, codexMetrics } = await collectMetrics(services, debug);

      let output: string;
      if (services.length === 1) {
        if (services.includes("claude") && claudeMetrics) {
          output = formatClaudeCapacityText(claudeMetrics);
        } else if (codexMetrics) {
          output = formatCodexCapacityText(codexMetrics);
        } else {
          output = formatCapacityWithAvailability(claudeMetrics, codexMetrics, available);
        }
      } else {
        output = formatCapacityWithAvailability(claudeMetrics, codexMetrics, available);
      }

      console.log(output);

      if (opts.predict) {
        const rawPreds = runPredictionsRaw(services, claudeMetrics, codexMetrics);
        for (const [, preds] of Object.entries(rawPreds)) {
          for (const [, pred] of Object.entries(preds)) {
            console.log(formatPredictionText(pred));
          }
        }
      }

      if (debug) {
        const elapsed = (performance.now() - startTime) / 1000;
        console.error(`\nExecution time: ${elapsed.toFixed(2)}s`);
      }
      return;
    }

    // --predict standalone: text prediction output
    if (opts.predict && !useJson && !opts.capacity && !opts.text) {
      const { claudeMetrics, codexMetrics } = await collectMetrics(services, debug);
      const rawPreds = runPredictionsRaw(services, claudeMetrics, codexMetrics);

      const lines: string[] = [];
      for (const [svc, preds] of Object.entries(rawPreds)) {
        for (const [metric, pred] of Object.entries(preds)) {
          lines.push(`${svc} ${metric}: ${formatPredictionText(pred)}`);
        }
      }
      if (lines.length === 0) {
        console.log("No prediction data available (no weekly metrics found).");
      } else {
        console.log(lines.join("\n"));
      }
      return;
    }

    if (opts.text) {
      // Single text snapshot
      const { claudeMetrics, codexMetrics } = await collectMetrics(services, debug);

      let output: string;
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

      console.log(output);

      if (debug) {
        const elapsed = (performance.now() - startTime) / 1000;
        console.error(`\nExecution time: ${elapsed.toFixed(2)}s`);
      }
      return;
    }

    if (useJson && !opts.live) {
      // Single JSON snapshot
      const { claudeMetrics, codexMetrics, sources, serviceInfo } = await collectMetrics(services, debug);
      const rawPreds = opts.predict ? runPredictionsRaw(services, claudeMetrics, codexMetrics) : undefined;
      const predictions = rawPreds ? predictionsToJson(rawPreds) : undefined;
      console.log(formatCombinedJson(claudeMetrics, codexMetrics, available, sources, serviceInfo, predictions));
      return;
    }

    if (useJson && opts.live) {
      // Continuous NDJSON stream to stdout
      const abortController = new AbortController();
      process.on("SIGINT", () => abortController.abort());

      while (!abortController.signal.aborted) {
        const loopStart = performance.now();
        const { claudeMetrics, codexMetrics, sources, serviceInfo } = await collectMetrics(services, debug, false);
        const output = formatCombinedJson(claudeMetrics, codexMetrics, available, sources, serviceInfo);
        // NDJSON: compact single-line JSON objects
        console.log(JSON.stringify(JSON.parse(output)));
        const elapsed = (performance.now() - loopStart) / 1000;
        await Bun.sleep(Math.max(0, refresh - elapsed) * 1000);
      }
      return;
    }

    // Launch TUI (default)
    const { render } = await import("@opentui/solid");
    const { App } = await import("../tui/App.js");
    // Pass validated service filter to TUI
    const tuiService = (services.length === 1 ? services[0] : "all") as "claude" | "codex" | "all";
    render(() => App({ service: tuiService }), { useMouse: true });
  });
