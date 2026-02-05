# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains usage monitoring scripts for Claude CLI and Codex CLI. The scripts launch the respective CLIs in detached tmux sessions, execute usage commands, parse the output, and display formatted usage statistics.

## Architecture

Both scripts follow the same pattern:

1. **Tmux Session Management**: Launch CLI tool in a detached tmux session to avoid user-visible terminal interference
2. **Command Execution**: Type commands character-by-character with delays to avoid autocomplete issues
3. **Output Parsing**: Capture tmux pane output and parse using grep/sed/awk
4. **Format Alignment**: Both scripts output in the same format for upstream dashboard integration

### Output Format

Both scripts produce pipe-separated metrics in this format:
```
[Label]: X% used (Y% remaining) (resets [time])
```

- Same-day reset times: `2:31pm` (12-hour format, lowercase am/pm, no dots)
- Future date reset times: `Feb 9 at 8:19pm` (Month Day at Time format)

## Scripts

### check-claude-usage.sh

Monitors Claude CLI usage with 3 metrics:
- **Session**: 5-hour rolling window
- **Weekly**: All models combined
- **Sonnet**: Sonnet-specific weekly limit

Usage command: `/usage`

### check-codex-usage.sh

Monitors Codex CLI usage with 2 metrics:
- **5h**: 5-hour limit
- **Weekly**: Weekly limit

Usage command: `/status`

**Parsing note**: The weekly limit reset time appears on a separate line in Codex output, requiring multi-line parsing logic.

## Running the Scripts

### Basic usage:
```bash
./check-claude-usage.sh
./check-codex-usage.sh
```

### Debug mode (shows execution time):
```bash
./check-claude-usage.sh --debug
./check-codex-usage.sh --debug
```

Expected execution times:
- Claude: ~8.5 seconds
- Codex: ~6.8 seconds

## Dependencies

Both scripts require:
- `tmux` - For session management
- `claude` or `codex` CLI - Respective CLI tools must be in PATH
- `bc` - For floating-point duration calculation in debug mode

## Key Implementation Details

### Time Format Conversion

Both scripts convert 24-hour time from CLI output to 12-hour format:
- macOS `date` outputs "p.m." with dots, which are removed using `sed 's/\.//g'`
- Time conversion: `date -j -f "%H:%M" "${HOUR}:${MINUTE}" "+%-I:%M%p"`

### Fallback Logic

When data is missing (e.g., fresh session with no usage):
- Percentages default to 0% used, 100% remaining
- Reset times calculated as:
  - 5-hour metrics: current time + 5 hours
  - Weekly metrics: current time + 7 days

### Case Sensitivity

Use case-insensitive grep (`grep -i`) when searching for metric labels since CLI output may vary capitalization.

## Modifying the Scripts

When making changes:

1. **Maintain format alignment**: Both scripts should produce the same output structure for dashboard integration
2. **Test parsing logic**: Use debug commands to verify output parsing before modifying sed/awk patterns
3. **Verify tmux cleanup**: Ensure `tmux kill-session` runs even on errors
4. **Test both with/without debug flag**: Verify behavior in both modes
