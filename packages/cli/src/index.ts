#!/usr/bin/env bun
/**
 * CLI entry point for lazyusage.
 * Port of src/cli.py
 */
import { Command } from "commander";
import { usageCheckCommand } from "./commands/usage-check.js";
import { usageCommand } from "./commands/usage.js";
import { planCommand } from "./commands/plan.js";

const program = new Command();

program
  .name("lazyusage")
  .description("Usage monitoring for Claude and Codex CLI")
  .version("0.1.0");

program.addCommand(usageCheckCommand);
program.addCommand(usageCommand);
program.addCommand(planCommand);

const rawArgs = process.argv.slice(2);
const passThroughCommands = new Set(["usage", "usage-check", "plan", "help"]);
const passThroughFlags = new Set(["-h", "--help", "-V", "--version"]);
const shouldInjectUsage = rawArgs.length === 0
  || (!passThroughCommands.has(rawArgs[0] ?? "") && !passThroughFlags.has(rawArgs[0] ?? ""));

program.parse(shouldInjectUsage ? [process.argv[0], process.argv[1], "usage", ...rawArgs] : process.argv);
