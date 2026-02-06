# Usage CLI

A unified Python CLI tool for monitoring Claude CLI and Codex CLI usage statistics, designed for both human monitoring and agent integration.

## Features

- **Two primary commands**: Fast snapshots (`usage-check`) and interactive monitoring (`usage`)
- **Auto-detection**: Automatically detects which CLIs are available
- **Service filtering**: Monitor Claude, Codex, or both
- **Multiple formats**: Text output (default), JSON (for automation), or interactive TUI
- **Agent-friendly**: JSON output with availability metadata for programmatic consumption
- **Live monitoring**: Real-time TUI with keyboard controls and loading animations
- **Visual feedback**: Loading spinners and refresh indicators in TUI mode

## Installation

### Via pip (recommended)

```bash
pip install usage-cli
```

### From source

```bash
# Clone repository
git clone https://github.com/jayfarei/usage-cli
cd usage-cli

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install in editable mode
pip install -e .
```

## Quick Start

### For Agents (Point-in-Time Checks)

```bash
# Auto-detect available CLIs and return JSON
usage-check --json

# Check specific service
usage-check claude --json
usage-check codex --json

# Force check both (errors if either unavailable)
usage-check all --json
```

### For Humans (Interactive Monitoring)

```bash
# Launch TUI (auto-detects available CLIs)
usage

# Monitor specific service
usage claude
usage codex

# Quick text snapshot
usage-check
```

## Command Reference

### `usage-check` - Fast Snapshot

Point-in-time query for current usage (~8-15s).

```bash
usage-check [SERVICE] [OPTIONS]
```

**Arguments:**
- `SERVICE`: `claude`, `codex`, or `all` (optional, defaults to auto-detect)

**Options:**
- `--json` - JSON output for agents
- `--text` - Text output (default)
- `--debug` - Show execution timing

**Examples:**
```bash
usage-check              # Auto-detect, text output
usage-check --json       # Auto-detect, JSON output
usage-check claude       # Claude only
usage-check all --json   # Force both, JSON output
```

---

### `usage` - Interactive Monitor

Long-running interactive TUI or continuous monitoring.

```bash
usage [SERVICE] [OPTIONS]
```

**Arguments:**
- `SERVICE`: `claude`, `codex`, or `all` (optional, defaults to auto-detect)

**Options:**
- `--text` - Single text snapshot
- `--refresh N` - Refresh interval in seconds (default: 10, min: 5)
- `--debug` - Show debug information

**TUI Keyboard Shortcuts:**
- `R` - Refresh now
- `P` - Pause/Resume auto-refresh
- `+` / `-` - Adjust refresh rate
- `?` - Show help
- `Q` - Quit

**Examples:**
```bash
usage                    # Launch TUI
usage claude --refresh 5 # Claude only, 5s refresh
usage --text             # Quick text output
```

## Output Formats

### Text Output

```
Claude: Session: 13% used (87% remaining) (resets 5:59pm) | Weekly: 5% used...
Codex: 5h: 1% used (99% remaining) (resets 7:58pm) | Weekly: 80% used...
```

### JSON Output

```json
{
  "timestamp": "2026-02-05T14:30:00.000000",
  "available_services": ["claude", "codex"],
  "services": [
    {
      "name": "claude",
      "available": true,
      "metrics": [
        {
          "name": "session",
          "used_pct": 13,
          "remaining_pct": 87,
          "resets": "5:59pm"
        }
      ]
    }
  ]
}
```

### Interactive TUI

```
┌─ Usage Monitor ──────────────────────┐
│ Claude Usage                          │
│ ⠋ Refreshing...                      │ ← Loading animation
│ Session  ▓▓▓▓▓░░░░░░░░ 25% (2:31pm)  │
│ Weekly   ▓▓▓░░░░░░░░░░ 15% (Feb 9)   │
├───────────────────────────────────────┤
│ ● Updated: 14:30:15 | Auto-refresh: ON│ ← Status bar with indicator
└───────────────────────────────────────┘
```

## Agent Integration

### Python Example

```python
import subprocess
import json

def check_capacity(service='claude', threshold=20):
    """Check if we have enough capacity to spawn sub-agent."""
    result = subprocess.run(
        ['usage-check', service, '--json'],
        capture_output=True,
        text=True,
        timeout=10
    )

    data = json.loads(result.stdout)

    for svc in data['services']:
        if not svc['available']:
            continue
        for metric in svc['metrics']:
            if metric['remaining_pct'] < threshold:
                return False, f"Low capacity: {metric['remaining_pct']}%"

    return True, "Capacity available"

# Use before spawning sub-agent
has_capacity, msg = check_capacity('claude', threshold=20)
if has_capacity:
    spawn_subagent()
else:
    print(f"Deferring: {msg}")
```

### Bash Example

```bash
#!/bin/bash
# Check capacity before expensive operation

json=$(usage-check claude --json)
remaining=$(echo "$json" | jq -r '.services[0].metrics[0].remaining_pct')

if [ "$remaining" -lt 20 ]; then
    echo "Low capacity: ${remaining}%"
    exit 1
else
    echo "Capacity OK: ${remaining}%"
    # Run operation
fi
```

## System Requirements

- **Python**: 3.8 or higher
- **tmux**: Must be installed separately
  - macOS: `brew install tmux`
  - Ubuntu/Debian: `apt-get install tmux`
  - Arch: `pacman -S tmux`
- **CLI Tools**: Claude CLI and/or Codex CLI must be in PATH

## Project Structure

```
usage-cli/
├── src/                    # Source code
│   ├── cli.py             # Main CLI entry points
│   ├── collectors/        # Data collectors (ephemeral & persistent)
│   ├── formatters/        # Output formatters (text, JSON, TUI)
│   ├── parsers/           # CLI output parsers
│   └── utils/             # Utilities (tmux, time)
├── examples/              # Integration examples
│   ├── agent_integration.py
│   └── agent_integration.sh
├── archive/               # Historical docs and tests
│   ├── docs/             # Implementation docs
│   ├── tests/            # Test scripts
│   └── scripts/          # Original bash scripts
├── README.md             # This file
├── LICENSE               # MIT License
├── setup.py              # Package setup
├── pyproject.toml        # Modern packaging
└── requirements.txt      # Dependencies
```

## Troubleshooting

### "No CLI tools found"

Install Claude CLI and/or Codex CLI and ensure they're in your PATH.

```bash
which claude  # Should return path
which codex   # Should return path
```

### TUI not updating

- Verify tmux is installed: `which tmux`
- Check CLIs are accessible: `claude --version`, `codex --version`
- Run with `--debug` flag to see timing information

### Orphaned tmux sessions

```bash
# List sessions
tmux ls

# Kill specific session
tmux kill-session -t usage-cli-12345

# Kill all usage sessions
tmux ls | grep usage | cut -d: -f1 | xargs -I {} tmux kill-session -t {}
```

## Development

### Running Tests

```bash
# Run all tests
./archive/tests/test_all_features.sh

# Test specific command
usage-check --help
usage --help
```

### Building Package

```bash
# Build distribution
python -m build

# Install from wheel
pip install dist/usage_cli-1.0.0-py3-none-any.whl

# Test installation
usage-check --version
```

### Contributing

See `archive/docs/` for implementation details and development documentation.

## Performance

### usage-check (Ephemeral Collectors)
- Claude only: ~8.5s
- Codex only: ~6.8s
- Both: ~15s

### usage TUI (Persistent Collectors)
- Initial load: ~8-15s
- Subsequent refreshes: ~2-3s (3x faster)
- Animation: 10 FPS

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- **Repository**: https://github.com/jayfarei/usage-cli
- **PyPI**: https://pypi.org/project/usage-cli/ (coming soon)
- **Issues**: https://github.com/jayfarei/usage-cli/issues

## Changelog

### v1.0.0 (2026-02-05)

- Initial release
- Two-command architecture (`usage-check`, `usage`)
- Auto-detection of available CLIs
- JSON API with availability metadata
- Interactive TUI with loading animations
- Agent integration examples (Python & Bash)
- Comprehensive documentation

---

**Status**: Ready for production use | Actively maintained
