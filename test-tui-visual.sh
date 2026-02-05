#!/bin/bash
# Visual verification test for TUI styling changes

set -e

source venv/bin/activate

SESSION_NAME="test-tui-visual-$$"

echo "=========================================="
echo "TUI Visual Verification Test"
echo "=========================================="
echo ""
echo "Launching TUI and waiting for metrics to load..."
echo ""

tmux new-session -d -s "$SESSION_NAME" "source venv/bin/activate && usage tui --refresh 10"

# Wait longer for collectors to fully initialize
echo "Waiting 15 seconds for full initialization..."
sleep 15

# Capture output
OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p)

# Kill session
tmux send-keys -t "$SESSION_NAME" "q"
sleep 3

# Cleanup any leaked sessions
tmux list-sessions 2>/dev/null | grep -E "claude-live-|codex-live-" | cut -d: -f1 | xargs -I {} tmux kill-session -t {} 2>/dev/null || true

echo "=========================================="
echo "TUI Output Sample"
echo "=========================================="
echo "$OUTPUT"
echo ""
echo "=========================================="
echo "Verification Checks"
echo "=========================================="
echo ""

# Check for Session (5h) label
if echo "$OUTPUT" | grep -q "Session (5h)"; then
    echo "✓ Label 'Session (5h)' found"
else
    echo "✗ Label 'Session (5h)' NOT found"
    echo "  (Metrics may still be loading)"
fi

# Check for Weekly labels
if echo "$OUTPUT" | grep -q "Weekly"; then
    echo "✓ Weekly labels found"
else
    echo "✗ Weekly labels NOT found"
    echo "  (Metrics may still be loading)"
fi

# Check JSON is not in footer
if echo "$OUTPUT" | grep -q " j .*JSON"; then
    echo "✗ JSON option still in footer"
else
    echo "✓ JSON option removed from footer"
fi

# Check for progress bars
if echo "$OUTPUT" | grep -qE '[▓░]'; then
    echo "✓ Progress bars rendered"
else
    echo "✗ Progress bars NOT found"
    echo "  (Metrics may still be loading)"
fi

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
