/**
 * plan command: Manage supervised capacity marks for prediction.
 * lazyusage plan <date> <regime> [<date> <regime> ...]
 * lazyusage plan list
 * lazyusage plan clear <date>
 * lazyusage plan clear --all
 */

import type { Regime } from "@lazyusage/core";
import { ExitCode, UsageStore } from "@lazyusage/core";
import { Command } from "commander";

const VALID_REGIMES = new Set(["L", "M", "H", "B"]);
const REGIME_LABELS: Record<string, string> = {
  L: "Low, 3%/day",
  M: "Medium, 9%/day",
  H: "High, 15%/day",
  B: "Burst, 25%/day",
};

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isValidDate(str: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  // Reject dates that normalize (e.g. 2026-02-30 → 2026-03-02)
  const [y, m, d] = str.split("-").map(Number);
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}

function isFutureOrToday(dateStr: string): boolean {
  const today = localDateStr(new Date());
  return dateStr >= today;
}

function isWithin14Days(dateStr: string): boolean {
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 14);
  return dateStr <= localDateStr(maxDate);
}

export const planCommand = new Command("plan")
  .description("Manage supervised capacity marks for prediction")
  .argument("[args...]", "date regime pairs, 'list', or 'clear'")
  .option("--all", "Clear all marks (use with 'clear')")
  .action(async (args: string[], opts: { all?: boolean }) => {
    if (!args || args.length === 0) {
      console.error("Usage: lazyusage plan <date> <regime> | list | clear <date> | clear --all");
      process.exit(ExitCode.FAILURE);
    }

    const store = new UsageStore();

    try {
      // plan list
      if (args[0] === "list") {
        const marks = store.getCapacityMarks();
        if (marks.length === 0) {
          console.log("No capacity marks set.");
          return;
        }
        for (const mark of marks) {
          console.log(`${mark.date}  ${mark.regime}  (${REGIME_LABELS[mark.regime] ?? mark.regime})`);
        }
        return;
      }

      // plan clear
      if (args[0] === "clear") {
        if (opts.all) {
          store.clearAllCapacityMarks();
          console.log("Cleared all capacity marks.");
          return;
        }
        if (args.length < 2) {
          console.error("Usage: lazyusage plan clear <date> or lazyusage plan clear --all");
          process.exit(ExitCode.FAILURE);
        }
        const date = args[1];
        if (!isValidDate(date)) {
          console.error(`Error: Invalid date format '${date}'. Use YYYY-MM-DD.`);
          process.exit(ExitCode.FAILURE);
        }
        store.clearCapacityMark(date);
        console.log(`Cleared mark for ${date}`);
        return;
      }

      // plan <date> <regime> [<date> <regime> ...]
      if (args.length % 2 !== 0) {
        console.error(
          "Error: Date-regime pairs must come in pairs. Usage: lazyusage plan <date> <regime> [<date> <regime> ...]",
        );
        process.exit(ExitCode.FAILURE);
      }

      for (let i = 0; i < args.length; i += 2) {
        const date = args[i];
        const regime = args[i + 1].toUpperCase();

        if (!isValidDate(date)) {
          console.error(`Error: Invalid date format '${date}'. Use YYYY-MM-DD.`);
          process.exit(ExitCode.FAILURE);
        }
        if (!isFutureOrToday(date)) {
          console.error(`Error: Date '${date}' is in the past.`);
          process.exit(ExitCode.FAILURE);
        }
        if (!isWithin14Days(date)) {
          console.error(`Error: Date '${date}' is more than 14 days in the future.`);
          process.exit(ExitCode.FAILURE);
        }
        if (!VALID_REGIMES.has(regime)) {
          console.error(`Error: Invalid regime '${regime}'. Must be L, M, H, or B.`);
          process.exit(ExitCode.FAILURE);
        }

        store.setCapacityMark(date, regime as Regime);
        console.log(`Marked ${date} as ${regime} (${REGIME_LABELS[regime]})`);
      }
    } finally {
      store.close();
    }
  });
