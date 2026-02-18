#!/usr/bin/env bun
/**
 * CLI entry point for usage-tui.
 * Port of src/cli.py
 */
import { Command } from "commander";
import { usageCheckCommand } from "./commands/usage-check.js";
import { usageCommand } from "./commands/usage.js";

const program = new Command();

program
  .name("usage-tui")
  .description("Usage monitoring for Claude and Codex CLI")
  .version("0.1.0");

program.addCommand(usageCheckCommand);
program.addCommand(usageCommand);

program.parse();
