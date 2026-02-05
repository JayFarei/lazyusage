# Usage CLI

A unified Python CLI tool for monitoring Claude CLI and Codex CLI usage statistics.

## Features

- **Individual reports**: Check Claude or Codex usage separately
- **Combined report**: View both CLIs at once
- **Live dashboard**: Real-time monitoring with progress bars
- **Multiple formats**: Text output (default) or JSON (for automation)
- **Output compatibility**: Matches bash script format exactly

## Installation

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install package
pip install -e .
```

## Usage

### Individual Reports

```bash
# Claude usage
usage claude

# Codex usage
usage codex

# Both CLIs
usage all
```

### JSON Output

```bash
# For automation/scripting
usage claude --json
usage codex --json
usage all --json
```

### Live Dashboard

```bash
# Default: 10-second refresh
usage --live

# Custom refresh interval (minimum 5s)
usage --live --refresh 5

# Alternative command
usage dashboard --refresh 30
```

### Debug Mode

```bash
# Show execution timing
usage claude --debug
usage codex --debug
usage all --debug

# Dashboard with debug info
usage --live --debug
```

## Output Format

### Text Output

Claude:
```
Session: 25% used (75% remaining) (resets 2:31pm) | Weekly: 15% used (85% remaining) (resets Feb 9 at 8:19pm) | Sonnet: 10% used (90% remaining) (resets Feb 9 at 8:19pm)
```

Codex:
```
5h: 20% used (80% remaining) (resets 3:15pm) | Weekly: 12% used (88% remaining) (resets Feb 10 at 9:00pm)
```

### JSON Output

```json
{
  "service": "claude",
  "timestamp": "2026-02-05T14:30:00.000000",
  "metrics": [
    {
      "name": "session",
      "used_pct": 25,
      "remaining_pct": 75,
      "resets": "2:31pm"
    },
    ...
  ]
}
```

### Live Dashboard

```
┌─ Usage Dashboard ─┐
│ Claude Usage       │
│ ▓▓▓▓░░░░░░ 25% Session (resets 2:31pm)      │
│ ▓▓▓░░░░░░░ 15% Weekly (resets Feb 9 at 8pm) │
│ ▓▓░░░░░░░░ 10% Sonnet (resets Feb 9 at 8pm) │
│ Codex Usage        │
│ ▓▓▓▓░░░░░░ 20% 5h (resets 3:15pm)           │
│ ▓▓░░░░░░░░ 12% Weekly (resets Feb 10 at 9pm)│
│ Last updated: 14:30 │ Refresh: 10s           │
└────────────────────┘
```

## Architecture

### Project Structure

```
src/
├── cli.py              # Main Click CLI entry point
├── collectors/
│   ├── base.py         # Abstract collector base classes
│   ├── claude.py       # Claude CLI collector
│   └── codex.py        # Codex CLI collector
├── parsers/
│   ├── claude.py       # Claude output parser
│   └── codex.py        # Codex output parser
├── formatters/
│   ├── text.py         # Text formatter
│   ├── json.py         # JSON formatter
│   └── dashboard.py    # Live dashboard
└── utils/
    ├── tmux.py         # Tmux session manager
    └── time.py         # Time formatting utilities
```

### Key Design Decisions

#### Two Collection Modes

1. **Ephemeral mode** (individual reports):
   - Create tmux session → execute command → capture output → cleanup
   - Used by: `usage claude`, `usage codex`, `usage all`
   - Performance: ~8.5s (Claude), ~6.8s (Codex)

2. **Persistent mode** (live dashboard):
   - Create session once → reuse for multiple refreshes → cleanup on exit
   - Used by: `usage --live`, `usage dashboard`
   - Performance: ~2-3s per refresh (Claude), ~1-2s per refresh (Codex)
   - **3x-4x faster** than ephemeral mode

#### Three-Phase Dashboard Workflow

1. **Windup**: Create persistent sessions, collect initial metrics
2. **Poll loop**: Refresh → render → sleep → repeat
3. **Winddown**: Cleanup sessions on Ctrl+C or exit

#### Output Format Compatibility

The Python CLI maintains exact output format compatibility with the original bash scripts for backward compatibility.

## Performance

### Ephemeral Mode
- Claude: ~8.5 seconds
- Codex: ~6.8 seconds
- Total (both): ~15 seconds

### Persistent Mode (Dashboard)
- Windup: ~4-5 seconds (one-time)
- Per refresh: ~4-5 seconds (both CLIs)
- Recommended refresh: 10 seconds
- Minimum refresh: 5 seconds

## Dependencies

- `click>=8.0` - CLI framework
- `rich>=13.0` - Terminal UI (dashboard)
- `python-dateutil>=2.8.0` - Date parsing
- `tmux` - Terminal multiplexer (must be installed separately)

## Backward Compatibility

The original bash scripts (`check-claude-usage.sh` and `check-codex-usage.sh`) are kept for:
- Users without Python installed
- Existing integrations/aliases
- Fallback if Python CLI has issues

Both implementations produce identical output in text mode.

## Development

### Running Tests

```bash
# Compare output with bash scripts
./check-claude-usage.sh > bash_claude.txt
usage claude > python_claude.txt
diff bash_claude.txt python_claude.txt  # Should be empty

# Verify JSON parsing
usage claude --json | jq .
```

### Adding New Features

1. **New collector**: Extend `EphemeralCollector` or `PersistentCollector` in `src/collectors/`
2. **New parser**: Add parsing logic in `src/parsers/`
3. **New formatter**: Implement in `src/formatters/`
4. **New CLI command**: Add to `src/cli.py` using Click decorators

## Troubleshooting

### tmux sessions not cleaning up

Check for orphaned sessions:
```bash
tmux ls
```

Kill specific session:
```bash
tmux kill-session -t claude-usage-12345
```

### Dashboard not updating

- Check that Claude/Codex CLIs are installed and in PATH
- Verify tmux is installed: `which tmux`
- Run with `--debug` flag to see detailed timing

### Output format differs from bash scripts

- Ensure you're using text mode (not JSON): `usage claude` (not `usage claude --json`)
- Check time formatting in `src/utils/time.py`
- Verify parser regex patterns in `src/parsers/`

## License

MIT
