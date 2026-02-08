# Usage CLI

A unified Python CLI tool for monitoring Claude CLI and Codex CLI usage statistics, designed for both human monitoring and agent integration.

## Features

- **Multi-source fetching**: API-first with intelligent fallback (API → PTY → Cache)
- **Fast & reliable**: ~1s via API (vs ~8s via tmux), graceful degradation
- **Usage history**: SQLite storage with deduplication, 30-day retention
- **Two primary commands**: Fast snapshots (`usage-check`) and interactive monitoring (`usage`)
- **Auto-detection**: Automatically detects which CLIs are available
- **Service filtering**: Monitor Claude, Codex, or both
- **Multiple formats**: Text output (default), JSON (for automation), or interactive TUI
- **Agent-friendly**: JSON output with availability metadata for programmatic consumption
- **Live monitoring**: Real-time TUI with keyboard controls and loading animations
- **Source transparency**: Shows where data came from (api/pty/cache)

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

## Architecture

### Multi-Source Fallback Chain

The tool uses a **3-tier fallback system** for maximum reliability:

```
┌──────────────┐
│ User Request │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────┐
│  1. API (Primary, ~1s)       │ ← Try official APIs first
│     ✓ Fast, reliable          │
│     ✓ No tmux overhead        │
│     ✗ Requires valid tokens   │
└──────┬───────────────────────┘
       │ (if fails)
       ▼
┌──────────────────────────────┐
│  2. PTY (Secondary, ~8s)     │ ← Fallback to CLI scraping
│     ✓ Works when API down    │
│     ✓ Same as before         │
│     ✗ Slower, tmux overhead  │
└──────┬───────────────────────┘
       │ (if fails)
       ▼
┌──────────────────────────────┐
│  3. Cache (Tertiary, instant)│ ← Last-known-good data
│     ✓ Better than nothing    │
│     ✗ May be stale (>5min)   │
└──────┬───────────────────────┘
       │ (if fails)
       ▼
┌──────────────────────────────┐
│  4. Fallback (zeros)         │ ← Calculated placeholder
└──────────────────────────────┘
```

### Data Sources Explained

#### 1. API Provider (Primary)

**Claude API:**
```
Endpoint: GET https://api.anthropic.com/api/oauth/usage
Auth: OAuth token from macOS Keychain or ~/.claude/.credentials.json
Speed: ~1s

Metrics:
- five_hour → Session (5h rolling window)
- seven_day → Weekly (all models)
- seven_day_sonnet → Weekly (Sonnet only)
```

**Codex API:**
```
Endpoint: GET https://chatgpt.com/backend-api/wham/usage
Auth: Access token from ~/.codex/auth.json
Speed: ~1s

Metrics:
- rate_limit.primary_window → 5h (5h rolling window)
- rate_limit.secondary_window → Weekly
```

**Credential Discovery:**
- **Claude**: Tries macOS Keychain → File fallback (`~/.claude/.credentials.json`)
- **Codex**: Reads `~/.codex/auth.json`
- **Auto-refresh**: CLIs handle token refresh automatically

#### 2. PTY Provider (Secondary)

Uses the existing tmux-based collectors as fallback:
- Spawns detached tmux sessions
- Types commands with character delays
- Scrapes terminal output with grep/sed/awk
- **Same parsers** as original bash scripts

Activated when:
- OAuth token expired/missing
- API endpoint unreachable
- Network issues

#### 3. Cache Provider (Tertiary)

Filesystem cache at `~/.cache/usage-cli/{service}.json`:
- Stores last successful fetch
- Returns if both API and PTY fail
- Marked "stale" if >5 minutes old

#### 4. Fallback Provider (Last Resort)

Returns zeros with calculated reset times based on current time + window duration.

### SQLite History Storage

**Location:** `~/.local/share/usage-cli/usage.db` (or `$USAGE_CLI_DB_PATH`)

**Features:**
- Stores all fetches with source tracking (api/pty/cache)
- Hybrid deduplication: stores if **value changed** OR **≥60s elapsed**
- Auto-cleanup: deletes snapshots >30 days on startup
- Collection grouping: UUID links related metrics from same fetch

**Schema:**
```sql
CREATE TABLE usage_snapshots (
    id INTEGER PRIMARY KEY,
    timestamp TEXT NOT NULL,           -- ISO 8601 UTC
    service TEXT NOT NULL,             -- 'claude' or 'codex'
    metric_name TEXT NOT NULL,         -- 'session', '5h', 'weekly', etc.
    used_pct INTEGER NOT NULL,         -- 0-100
    remaining_pct INTEGER NOT NULL,    -- 0-100
    resets TEXT,                       -- Display format "2:31pm"
    resets_at TEXT,                    -- ISO 8601 for queries
    subscription_type TEXT,            -- "max", "Plus", etc.
    source TEXT NOT NULL,              -- 'api', 'pty', 'cache', 'fallback'
    collection_id TEXT                 -- UUID groups related snapshots
);
```

**Storage estimates:**
- ~280KB/day worst case (10s refresh, heartbeat every 60s)
- ~8.4MB/month
- Auto-pruned to 30 days = ~250MB max

**Integration:**
- `usage-check`: Stores each fetch
- `usage` (TUI): Stores with deduplication on refresh
- `usage-dashboard`: Stores with deduplication on refresh

### Source Transparency

The `--debug` flag shows which data source was used:

```bash
$ usage-check claude --debug
Collecting Claude metrics...
  Source: api                    # ← Using API (fast!)

Session: 13% used (87% remaining)...
Execution time: 0.96s
```

```bash
$ usage-check claude --debug
Collecting Claude metrics...
  Source: pty                    # ← Fell back to PTY
  Warning: Data is stale         # ← Cache warning if applicable

Session: 13% used (87% remaining)...
Execution time: 8.45s
```

The TUI status bar also shows the active source:
```
Last updated: 21:18:11 | Auto-refresh: ON (10s) | Source: claude: api | codex: api
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
- **Python packages**:
  - `requests` - For API calls
  - `textual` - For TUI
  - `rich` - For formatting
  - `click` - For CLI interface
- **tmux**: Required for PTY fallback (optional if API working)
  - macOS: `brew install tmux`
  - Ubuntu/Debian: `apt-get install tmux`
  - Arch: `pacman -S tmux`
- **CLI Tools**: Claude CLI and/or Codex CLI must be in PATH and authenticated
  - Run `claude` or `codex` once to authenticate before using this tool

## Project Structure

```
usage-cli/
├── src/                        # Source code
│   ├── cli.py                 # Main CLI entry points
│   ├── providers/             # Multi-source data providers (NEW)
│   │   ├── api.py            # Direct API calls (Claude/Codex)
│   │   ├── pty.py            # PTY/tmux-based fallback
│   │   ├── cache.py          # Filesystem cache
│   │   ├── chain.py          # Fallback orchestration
│   │   ├── credentials.py    # OAuth token discovery
│   │   └── factory.py        # Provider chain factories
│   ├── storage/               # Usage history database (NEW)
│   │   ├── database.py       # SQLite storage
│   │   └── dedup.py          # Deduplication logic
│   ├── collectors/            # Legacy PTY collectors
│   │   ├── claude.py         # Claude tmux collector
│   │   └── codex.py          # Codex tmux collector
│   ├── formatters/            # Output formatters
│   │   ├── text.py           # Text formatter
│   │   ├── json.py           # JSON formatter
│   │   ├── tui.py            # Interactive TUI
│   │   └── dashboard.py      # Live dashboard
│   ├── parsers/               # CLI output parsers
│   │   ├── claude.py         # Parse Claude CLI output
│   │   └── codex.py          # Parse Codex CLI output
│   └── utils/                 # Utilities
│       ├── tmux.py           # Tmux helpers
│       ├── time.py           # Time formatting
│       └── bars.py           # Progress bars
├── examples/                  # Integration examples
│   ├── agent_integration.py
│   └── agent_integration.sh
├── archive/                   # Historical docs and tests
│   ├── docs/                 # Implementation docs
│   ├── tests/                # Test scripts
│   └── scripts/              # Original bash scripts
├── README.md                 # This file
├── LICENSE                   # MIT License
├── setup.py                  # Package setup
├── pyproject.toml            # Modern packaging
└── requirements.txt          # Dependencies
```

## Troubleshooting

### "No CLI tools found"

Install Claude CLI and/or Codex CLI and ensure they're in your PATH.

```bash
which claude  # Should return path
which codex   # Should return path
```

### Slow performance (using PTY instead of API)

Check if API is being used:

```bash
usage-check claude --debug
# Should show "Source: api" (fast)
# If showing "Source: pty" (slow), check below
```

**If stuck on PTY:**

1. **Check authentication:**
   ```bash
   # Run the CLI once to authenticate
   claude
   # or
   codex
   ```

2. **Check credentials exist:**
   ```bash
   # Claude - check Keychain or file
   security find-generic-password -s "Claude Code-credentials" -w
   # OR
   cat ~/.claude/.credentials.json

   # Codex - check file
   cat ~/.codex/auth.json
   ```

3. **Check token validity:**
   - Claude tokens expire after some time
   - Running `claude` will auto-refresh tokens
   - The tool will automatically fall back to PTY if tokens invalid

### TUI not updating

- Verify tmux is installed: `which tmux`
- Check CLIs are accessible: `claude --version`, `codex --version`
- Run with `--debug` flag to see timing and source information

### Data source showing "cache (stale)"

This means both API and PTY failed, using last-known-good data >5 minutes old:

1. Check network connectivity
2. Verify CLI tools are working: `claude`, `codex`
3. Check if tokens expired (run CLIs manually to refresh)
4. If persistent, check tmux: `tmux ls | grep usage`

### Database issues

**Corrupted database:**
```bash
# Backup and delete
mv ~/.local/share/usage-cli/usage.db ~/.local/share/usage-cli/usage.db.bak
# Tool will create new DB on next run
```

**Change database location:**
```bash
export USAGE_CLI_DB_PATH="/custom/path/usage.db"
usage-check
```

**Query database directly:**
```bash
sqlite3 ~/.local/share/usage-cli/usage.db
# Examples:
# SELECT COUNT(*) FROM usage_snapshots;
# SELECT * FROM usage_snapshots ORDER BY timestamp DESC LIMIT 10;
# .schema usage_snapshots
```

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

### usage-check (API Primary, PTY Fallback)

**With API (typical):**
- Claude only: **~1s** (was ~8.5s with PTY-only)
- Codex only: **~1s** (was ~6.8s with PTY-only)
- Both: **~2s** (was ~15s with PTY-only)

**With PTY fallback (when API unavailable):**
- Claude only: ~8.5s
- Codex only: ~6.8s
- Both: ~15s

### usage TUI (Persistent Chain)

**With API (typical):**
- Initial load: **~1-2s**
- Subsequent refreshes: **~1s** per service
- Refresh rate: 5-60s (default 10s)

**With PTY fallback:**
- Initial load: ~8-15s
- Subsequent refreshes: ~2-3s (reuses tmux session)

### Database Storage

- Write performance: ~1ms per snapshot (deduped)
- Storage growth: ~280KB/day (10s refresh, 60s heartbeat)
- Auto-cleanup: Removes >30 days on startup
- Max size: ~8.4MB/month, ~250MB with 30-day retention

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- **Repository**: https://github.com/jayfarei/usage-cli
- **PyPI**: https://pypi.org/project/usage-cli/ (coming soon)
- **Issues**: https://github.com/jayfarei/usage-cli/issues

## Changelog

### v2.0.0 (2026-02-08)

**Major architectural upgrade:**
- 🚀 **Multi-source fetching**: API-first with intelligent fallback (API → PTY → Cache)
- ⚡ **8x faster**: ~1s via API vs ~8s via tmux (typical case)
- 💾 **Usage history**: SQLite storage with deduplication and 30-day auto-cleanup
- 🔍 **Source transparency**: Debug flag shows data source (api/pty/cache)
- 🔐 **OAuth credential discovery**: Reads from Keychain (Claude) or file (Codex)
- 🛡️ **Robust error handling**: Graceful degradation through fallback chain

**API Providers:**
- Direct HTTPS calls to official Claude/Codex APIs
- Claude: Keychain → file fallback for OAuth tokens
- Codex: File-based access token (`~/.codex/auth.json`)
- Accurate field mappings (fixed `seven_day` vs `seven_day_sonnet` confusion)

**Storage Layer:**
- SQLite database at `~/.local/share/usage-cli/usage.db`
- Hybrid deduplication: stores on change OR 60s heartbeat
- Source tracking: know if data came from api/pty/cache
- Collection grouping: UUID links related metrics
- Auto-cleanup: deletes >30 days on startup

**Performance:**
- `usage-check`: 1-2s (was 8-15s)
- `usage` TUI: 1s refresh (was 2-3s)
- Storage: <1ms writes, ~280KB/day, ~250MB max (30d retention)

**Backwards compatibility:**
- All existing commands work unchanged
- PTY collectors still available as fallback
- Same output formats (text/JSON/TUI)

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
