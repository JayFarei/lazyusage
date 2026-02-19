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
} from "@lazyusage/core";
import { detectAvailableServices, validateService, collectMetrics } from "./usage-check.js";

const GROUPED_HELP = `
Human Options:
  --live              Enable continuous updates (TUI mode by default)
  --refresh <seconds> Refresh interval in seconds (default: 10, min: 5)

Agent Options:
  --text              Text output, single refresh
  --json              JSON output instead of TUI
  --debug             Show debug information

Software Integration:
  --serve             Start HTTP server (polling + streaming endpoints)
  --port <number>     Server port (default: 8080, requires --serve)

Other:
  -h, --help          display help for command

Modes:
  usage                      Launch TUI (default)
  usage --text               Quick text snapshot
  usage --json               Single JSON snapshot to stdout
  usage --json --live        Continuous NDJSON stream to stdout
  usage --serve              Start HTTP server on port 8080
  usage --serve --port 3000  Server on custom port`;

export const usageCommand = new Command("usage")
  .description("Interactive TUI or continuous monitoring")
  .argument("[service]", "Service to monitor: claude, codex, or all")
  .option("--live", "Enable continuous updates (TUI mode by default)")
  .option("--json", "JSON output instead of TUI")
  .option("--text", "Text output, single refresh")
  .option("--refresh <seconds>", "Refresh interval in seconds (default: 10, min: 5)", "10")
  .option("--debug", "Show debug information")
  .option("--serve", "Start HTTP server (polling + streaming endpoints)")
  .option("--port <number>", "Server port (default: 8080, requires --serve)", "8080")
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
      text?: boolean;
      refresh?: string;
      debug?: boolean;
      serve?: boolean;
      port?: string;
    },
  ) => {
    const startTime = performance.now();
    const available = detectAvailableServices();
    const services = validateService(service, available);
    const refresh = Math.max(5, parseInt(opts.refresh ?? "10", 10));
    const debug = opts.debug ?? false;
    const port = parseInt(opts.port ?? "8080", 10);

    // Validate flag conflicts
    if (opts.serve && opts.text) {
      console.error("Error: --serve and --text are mutually exclusive.");
      process.exit(1);
    }
    if (opts.serve && opts.live) {
      console.error("Error: --serve and --live are mutually exclusive (server has its own streaming).");
      process.exit(1);
    }
    if (opts.serve && opts.json) {
      console.error("Error: --serve and --json are mutually exclusive (server already outputs JSON).");
      process.exit(1);
    }
    if (opts.port !== "8080" && !opts.serve) {
      console.error("Error: --port requires --serve.");
      process.exit(1);
    }

    // Route to appropriate mode
    if (opts.serve) {
      const { startServer } = await import("../server/index.js");
      startServer({ services, port, refreshInterval: refresh, debug });
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

    if (opts.json && !opts.live) {
      // Single JSON snapshot
      const { claudeMetrics, codexMetrics } = await collectMetrics(services, debug);
      console.log(formatCombinedJson(claudeMetrics, codexMetrics, available));
      return;
    }

    if (opts.json && opts.live) {
      // Continuous NDJSON stream to stdout
      const abortController = new AbortController();
      process.on("SIGINT", () => abortController.abort());

      while (!abortController.signal.aborted) {
        const { claudeMetrics, codexMetrics } = await collectMetrics(services, debug, false);
        const output = formatCombinedJson(claudeMetrics, codexMetrics, available);
        // NDJSON: compact single-line JSON objects
        console.log(JSON.stringify(JSON.parse(output)));
        await Bun.sleep(refresh * 1000);
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
