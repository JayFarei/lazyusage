# Subscription Type Display Fix

## Problem
The TUI was showing "Codex Usage - Plus" correctly but "Claude Usage" without the subscription type. The subscription extraction worked in unit tests but not in the live TUI.

## Root Cause
The subscription type information appears on the **Claude CLI landing page** (the initial welcome screen), not in the `/usage` command output. The collectors were only capturing the `/usage` output, missing the subscription information entirely.

### Output Locations
- **Landing page:** `Sonnet 4.5 · Claude Max` ✓ Has subscription
- **Usage output:** Only shows usage metrics ✗ No subscription

### Why Codex Worked
Codex subscription appears in the `/status` command output itself:
```
Account: user@example.com (Plus)
```
So Codex never had this issue.

## Solution

### 1. Updated Collectors (`src/collectors/claude.py`)
Modified both `ClaudeEphemeralCollector` and `ClaudePersistentCollector` to:
1. Capture the **landing page** output (contains subscription)
2. Capture the **usage command** output (contains metrics)
3. Combine both outputs before parsing

**ClaudeEphemeralCollector changes:**
- Wait 1 second for landing page to render
- Capture landing page before sending `/usage`
- Combine landing + usage outputs for parsing

**ClaudePersistentCollector changes:**
- Store landing page output in `self.landing_output` during `start()`
- Reuse stored landing output for all subsequent `refresh()` calls
- Combine stored landing + new usage output for each parse

### 2. Improved Parser (`src/parsers/claude.py`)
Enhanced `parse_subscription()` function with priority-based matching:

**Priority 1:** Match subscription tiers with `·` separator
```
Pattern: · Claude Max|Pro|Plus
Example: "Sonnet 4.5 · Claude Max"
```

**Priority 2:** Search for subscription keywords near "Claude"/"Sonnet" lines
```
Keywords: Max, Pro, Plus
```

**Priority 3:** Generic "Claude [Type]" but exclude product names
```
Exclusion: "Claude Code" (product name, not subscription)
```

This ensures "Claude Max" is extracted correctly even when "Claude Code" appears in the same output.

### 3. Updated Tests
Added new test cases in `test-subscription-extraction.sh`:
- ✓ Claude Code correctly ignored
- ✓ Max preferred over Code when both present
- ✓ Updated Claude Max test to use real format (with `·`)

## Verification

### Unit Tests
```bash
./archive/tests/test-subscription-extraction.sh
```
All tests pass including new cases for "Claude Code" handling.

### Integration Test
```python
from src.collectors.claude import ClaudeEphemeralCollector
from src.formatters.text import format_claude

metrics = ClaudeEphemeralCollector().collect()
print(format_claude(metrics))
# Output: "... [Subscription: Max]" ✓
```

### Live TUI
When you run `usage` (TUI), you should now see:
- **Claude Usage - Max** (instead of just "Claude Usage")
- **Codex Usage - Plus** (unchanged, still working)

## Files Modified
1. `src/collectors/claude.py` - Capture landing page + usage output
2. `src/parsers/claude.py` - Improved subscription extraction logic
3. `archive/tests/test-subscription-extraction.sh` - Added new test cases

## No Changes Needed
- ✓ Formatters (already handle subscription correctly)
- ✓ Codex collectors (Codex subscription already in `/status` output)
- ✓ Other parsers (no changes needed)

## Testing the Fix

**Quick verification:**
```bash
# Run subscription extraction tests
./archive/tests/test-subscription-extraction.sh

# Run the TUI
usage

# Should now show:
# ┌─ Claude Usage - Max ─┐
# └───────────────────────┘
```

## Performance Impact
Minimal - adds ~1 second to initial session startup for landing page capture. The landing page is captured once and reused for all refreshes in persistent collectors.
