# Claude Usage Monitor - Alias Setup

## Quick Access Alias

To make the script easily accessible from anywhere, add this alias to your shell configuration:

### For Zsh (default on macOS)
Add to `~/.zshrc`:
```bash
alias claude-usage='/Users/jayfarei/src/tries/2026-02-05-test-usage-via-cli/check-claude-usage.sh'
```

### For Bash
Add to `~/.bashrc`:
```bash
alias claude-usage='/Users/jayfarei/src/tries/2026-02-05-test-usage-via-cli/check-claude-usage.sh'
```

## Applying the Changes

After adding the alias, reload your shell configuration:

**Zsh:**
```bash
source ~/.zshrc
```

**Bash:**
```bash
source ~/.bashrc
```

## Usage

After setup, simply run:
```bash
claude-usage
```

This will display your Claude usage statistics in a compact single-line format with both used and remaining percentages.
