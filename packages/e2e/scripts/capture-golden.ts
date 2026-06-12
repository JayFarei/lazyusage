/**
 * Phase 0: Capture golden master frames before any code changes.
 * Run: bun run packages/e2e/scripts/capture-golden.ts
 */

import { join } from "node:path";
import { captureGoldenFrames } from "../src/helpers/golden.js";

const ROOT = join(import.meta.dir, "../../..");
const OUTPUT_DIR = join(ROOT, "packages/e2e/golden");
const TUI_SCRIPT = join(ROOT, "packages/cli/src/index.ts");
const PRELOAD = join(ROOT, "packages/cli/node_modules/@opentui/solid/scripts/preload.ts");

// The command that gets typed into tmux to launch the TUI
const TUI_CMD = `bun --preload=${PRELOAD} ${TUI_SCRIPT} usage`;

console.log("Phase 0: Capturing visual golden masters");
console.log(`Output: ${OUTPUT_DIR}`);
console.log(`TUI command: ${TUI_CMD}`);
console.log("");

// Verify tmux is available
const tmuxCheck = Bun.spawnSync(["which", "tmux"]);
if (tmuxCheck.exitCode !== 0) {
  console.error("Error: tmux is required for golden master capture");
  process.exit(1);
}

const results = await captureGoldenFrames(TUI_CMD, OUTPUT_DIR, [
  { width: 70, height: 35 },
  { width: 80, height: 24 },
  { width: 120, height: 40 },
  { width: 200, height: 60 },
]);

console.log("\nCapture complete:");
for (const [key, result] of results) {
  const inv = result.invariants;
  console.log(`  ${key}:`);
  console.log(`    Claude panel: ${inv.hasClaude}`);
  console.log(`    Codex panel:  ${inv.hasCodex}`);
  console.log(`    Status bar:   ${inv.hasStatusBar}`);
  console.log(`    Bars:         ${inv.hasBars}`);
  console.log(`    Marker lines: ${inv.markerLines.length}`);
  console.log(`    Bar lines:    ${inv.barLines.length}`);
  if (inv.markerLines.length > 0) {
    const allValid = inv.markerLines.every((m) => m.valid);
    console.log(`    Equidistant:  ${allValid}`);
    // Show first marker line as example
    const first = inv.markerLines[0];
    console.log(`    Example markers: [${first.positions.join(", ")}] gap=${first.gap}`);
  }
}

console.log("\nGolden masters saved to packages/e2e/golden/");
