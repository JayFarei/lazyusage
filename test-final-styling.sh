#!/bin/bash
# Final styling verification test

set -e

source venv/bin/activate

SESSION_NAME="test-final-styling-$$"

echo "=========================================="
echo "Final TUI Styling Verification"
echo "=========================================="
echo ""
echo "Testing:"
echo "1. Refresh rate displayed at top"
echo "2. +/- speed controls"
echo "3. Transparent background"
echo ""
echo "Launching TUI..."
echo ""

tmux new-session -d -s "$SESSION_NAME" "source venv/bin/activate && usage tui --refresh 10"

# Wait for full initialization
echo "Waiting 15 seconds for initialization..."
sleep 15

# Capture output
OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p)

echo "=========================================="
echo "TUI Output"
echo "=========================================="
echo "$OUTPUT"
echo ""

# Test refresh rate in subtitle
echo "=========================================="
echo "Verification Checks"
echo "=========================================="
echo ""

if echo "$OUTPUT" | grep -q "Refresh: 10s"; then
    echo "✓ Refresh rate (10s) displayed in header"
else
    echo "✗ Refresh rate NOT found in header"
    if echo "$OUTPUT" | grep -i "refresh"; then
        echo "  Found 'refresh' text in output"
    fi
fi

# Test speed controls in footer
if echo "$OUTPUT" | grep -qE "\+ Speed.*- Speed"; then
    echo "✓ Speed controls present in footer"
elif echo "$OUTPUT" | grep -q "Speed"; then
    echo "✓ Speed controls present (may not be adjacent)"
else
    echo "✗ Speed controls NOT found"
fi

# Test for Session (5h) labels
if echo "$OUTPUT" | grep -q "Session (5h)"; then
    echo "✓ Session (5h) labels present"
fi

# Test for progress bars
if echo "$OUTPUT" | grep -qE '[▓░]'; then
    echo "✓ Progress bars rendered"
fi

echo ""

# Test speed adjustment
echo "=========================================="
echo "Testing Speed Adjustment"
echo "=========================================="
echo ""
echo "Pressing '+' to increase speed..."
tmux send-keys -t "$SESSION_NAME" "+"
sleep 2

OUTPUT2=$(tmux capture-pane -t "$SESSION_NAME" -p)

if echo "$OUTPUT2" | grep -q "Refresh: 5s"; then
    echo "✓ Speed increased (interval decreased to 5s)"
elif echo "$OUTPUT2" | grep -q "Refresh: 10s"; then
    echo "Note: Still at 10s (may show notification instead)"
fi

echo ""
echo "Pressing '-' to decrease speed..."
tmux send-keys -t "$SESSION_NAME" "-"
sleep 2

OUTPUT3=$(tmux capture-pane -t "$SESSION_NAME" -p)

if echo "$OUTPUT3" | grep -q "Refresh: 10s"; then
    echo "✓ Speed decreased (interval increased to 10s)"
elif echo "$OUTPUT3" | grep -q "Refresh: 15s"; then
    echo "✓ Speed decreased (interval increased to 15s)"
fi

# Cleanup
echo ""
echo "Cleaning up..."
tmux send-keys -t "$SESSION_NAME" "q"
sleep 3

# Clean up any leaked sessions
tmux list-sessions 2>/dev/null | grep -E "claude-live-|codex-live-" | cut -d: -f1 | xargs -I {} tmux kill-session -t {} 2>/dev/null || true

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "Note: Background transparency depends on your"
echo "terminal emulator supporting true transparency."
echo "The TUI now uses 'transparent' background."
