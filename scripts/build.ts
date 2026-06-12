#!/usr/bin/env bun
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
/**
 * Build publishable workspace artifacts.
 *
 * Usage: bun run build
 * Outputs:
 *   packages/core/dist/   - compiled JS + declarations
 *   packages/cli/dist/    - publishable CLI bundle + ledger worker
 */
import solidTransformPlugin from "../packages/cli/node_modules/@opentui/solid/scripts/solid-plugin";

const rootDir = new URL("../", import.meta.url).pathname;
const coreDir = `${rootDir}packages/core`;
const cliDir = `${rootDir}packages/cli`;
const coreDistDir = `${coreDir}/dist`;
const cliDistDir = `${cliDir}/dist`;

rmSync(coreDistDir, { recursive: true, force: true });
rmSync(cliDistDir, { recursive: true, force: true });
mkdirSync(coreDistDir, { recursive: true });
mkdirSync(cliDistDir, { recursive: true });

const coreBuild = Bun.spawnSync(["bunx", "tsc", "-p", "packages/core/tsconfig.json"], {
  cwd: rootDir,
  stdout: "inherit",
  stderr: "inherit",
});

if (coreBuild.exitCode !== 0) {
  process.exit(coreBuild.exitCode);
}

// Build 1: main CLI (JSX transform required for SolidJS components)
const cliResult = await Bun.build({
  entrypoints: ["./packages/cli/src/index.ts"],
  outdir: "./packages/cli/dist",
  target: "bun",
  naming: "cli.js",
  plugins: [solidTransformPlugin],
  // @opentui/core must be external (native arm64/x64 binary cannot be bundled).
  // @opentui/solid and solid-js are bundled together so they share a single reactive
  // runtime instance. Making solid-js external causes Bun to pick up the SSR version.
  external: ["better-sqlite3", "bun:sqlite", "bun:ffi", "@opentui/core", "lazyusage-core"],
  root: rootDir,
});

if (!cliResult.success) {
  for (const log of cliResult.logs) console.error(log);
  process.exit(1);
}

// Build 2: ledger worker (no JSX, plain TypeScript, self-contained)
// Lives alongside packages/cli/dist/cli.js so WORKER_PATH detection in useLedgerData.ts
// picks it up via: existsSync("./ledger-worker.js") relative to import.meta.url
const workerResult = await Bun.build({
  entrypoints: ["./packages/cli/src/tui/lib/ledger-worker.ts"],
  outdir: "./packages/cli/dist",
  target: "bun",
  naming: "ledger-worker.js",
  external: ["bun:sqlite", "bun:ffi"],
  root: rootDir,
});

if (!workerResult.success) {
  for (const log of workerResult.logs) console.error(log);
  process.exit(1);
}

// pty.ts compiles pty_helpers.c at runtime via Bun.cc(), resolving the source
// next to the executing module - so the .c file must ship inside both dists.
copyFileSync(`${coreDir}/src/utils/pty_helpers.c`, `${coreDistDir}/utils/pty_helpers.c`);
copyFileSync(`${coreDir}/src/utils/pty_helpers.c`, `${cliDistDir}/pty_helpers.c`);

const outputs = [...cliResult.outputs, ...workerResult.outputs].map((o) => o.path);
console.log("Build complete:", outputs.join(", "));
