#!/usr/bin/env bun
/**
 * Pre-bundle the CLI entry point and ledger worker using the SolidJS transform plugin.
 * Eliminates the Babel/JSX transform at launch time for faster cold starts.
 *
 * Usage: bun run build
 * Outputs:
 *   dist/cli.js          - main TUI binary (run with: bun dist/cli.js usage)
 *   dist/ledger-worker.js - standalone worker for JSONL parsing
 */
import solidTransformPlugin from "../packages/cli/node_modules/@opentui/solid/scripts/solid-plugin";
import { mkdirSync } from "fs";

mkdirSync("dist", { recursive: true });

// Build 1: main CLI (JSX transform required for SolidJS components)
const cliResult = await Bun.build({
  entrypoints: ["./packages/cli/src/index.ts"],
  outdir: "./dist",
  target: "bun",
  naming: "cli.js",
  plugins: [solidTransformPlugin],
  // @opentui/core must be external (native arm64/x64 binary cannot be bundled).
  // @opentui/solid and solid-js are bundled together so they share a single reactive
  // runtime instance. Making solid-js external causes Bun to pick up the SSR version.
  external: ["better-sqlite3", "bun:sqlite", "bun:ffi", "@opentui/core"],
});

if (!cliResult.success) {
  for (const log of cliResult.logs) console.error(log);
  process.exit(1);
}

// Build 2: ledger worker (no JSX, plain TypeScript, self-contained)
// Lives alongside dist/cli.js so the WORKER_PATH detection in useLedgerData.ts
// picks it up via: existsSync("./ledger-worker.js") relative to import.meta.url
const workerResult = await Bun.build({
  entrypoints: ["./packages/cli/src/tui/lib/ledger-worker.ts"],
  outdir: "./dist",
  target: "bun",
  naming: "ledger-worker.js",
  external: ["bun:sqlite", "bun:ffi"],
});

if (!workerResult.success) {
  for (const log of workerResult.logs) console.error(log);
  process.exit(1);
}

const outputs = [...cliResult.outputs, ...workerResult.outputs].map((o) => o.path);
console.log("Build complete:", outputs.join(", "));
