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
  ExitCode,
  setLogLevel,
  type LogLevel,
} from "@lazyusage/core";
import { detectAvailableServices, validateService, collectMetrics } from "./usage-check.js";

const GROUPED_HELP = `
Human Options:
  --live              Enable continuous NDJSON stream (use with --json)
  --refresh <seconds> Refresh interval in seconds (default: 10, min: 5)

Agent Options:
  --text              Text output, single refresh
  --json              JSON output instead of TUI
  --json-only         JSON output with errors as JSON on stdout (machine-safe)
  --capacity          Filter output to capacity_remaining only (use with --text or --json)
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
          const { claudeMetrics, codexMetrics, sources } = await collectMetrics(services, debug);
          console.log(formatCombinedCapacityJson(claudeMetrics, codexMetrics, available, sources));
          return;
        }

        const { claudeMetrics, codexMetrics, sources } = await collectMetrics(services, debug);
        console.log(formatCombinedJson(claudeMetrics, codexMetrics, available, sources));
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
        const { claudeMetrics, codexMetrics, sources } = await collectMetrics(services, debug, false);
        const output = formatCombinedCapacityJson(claudeMetrics, codexMetrics, available, sources);
        console.log(JSON.stringify(JSON.parse(output)));
        const elapsed = (performance.now() - loopStart) / 1000;
        await Bun.sleep(Math.max(0, refresh - elapsed) * 1000);
      }
      return;
    }

    // --capacity --json: capacity JSON snapshot
    if (opts.capacity && useJson) {
      const { claudeMetrics, codexMetrics, sources } = await collectMetrics(services, debug);
      console.log(formatCombinedCapacityJson(claudeMetrics, codexMetrics, available, sources));
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

      if (debug) {
        const elapsed = (performance.now() - startTime) / 1000;
        console.error(`\nExecution time: ${elapsed.toFixed(2)}s`);
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
      const { claudeMetrics, codexMetrics, sources } = await collectMetrics(services, debug);
      console.log(formatCombinedJson(claudeMetrics, codexMetrics, available, sources));
      return;
    }

    if (useJson && opts.live) {
      // Continuous NDJSON stream to stdout
      const abortController = new AbortController();
      process.on("SIGINT", () => abortController.abort());

      while (!abortController.signal.aborted) {
        const loopStart = performance.now();
        const { claudeMetrics, codexMetrics, sources } = await collectMetrics(services, debug, false);
        const output = formatCombinedJson(claudeMetrics, codexMetrics, available, sources);
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
