#!/bin/bash
# Test Catppuccin Mocha theme implementation

set -e

source venv/bin/activate

SESSION_NAME="test-catppuccin-$$"
SCREENSHOT_DIR="screenshots"

mkdir -p "$SCREENSHOT_DIR"

echo "=========================================="
echo "Catppuccin Mocha Theme Test"
echo "=========================================="
echo ""
echo "Testing TUI with Catppuccin Mocha colors:"
echo "  Base: #1e1e2e (background)"
echo "  Text: #cdd6f4 (text)"
echo ""

echo "Launching TUI in tmux..."
tmux new-session -d -s "$SESSION_NAME" "source venv/bin/activate && usage tui --refresh 10"

# Wait for full initialization
echo "Waiting 15 seconds for initialization..."
sleep 15

# Capture text output
OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p)

echo "=========================================="
echo "TUI Output"
echo "=========================================="
echo "$OUTPUT"
echo ""

# Verify the TUI is working
echo "=========================================="
echo "Verification"
echo "=========================================="
echo ""

if echo "$OUTPUT" | grep -q "Usage Monitor"; then
    echo "✓ TUI launched successfully"
fi

if echo "$OUTPUT" | grep -q "Refresh: 10s"; then
    echo "✓ Refresh rate displayed"
fi

if echo "$OUTPUT" | grep -q "Session (5h)"; then
    echo "✓ Metrics loaded"
fi

if echo "$OUTPUT" | grep -qE '[▓░]'; then
    echo "✓ Progress bars rendered"
fi

echo ""
echo "=========================================="
echo "Screenshot Instructions"
echo "=========================================="
echo ""
echo "The TUI is running in tmux session: $SESSION_NAME"
echo ""
echo "To take a screenshot:"
echo "1. Open a new terminal window"
echo "2. Run: tmux attach -t $SESSION_NAME"
echo "3. Take a screenshot of the terminal"
echo "4. Save to: $SCREENSHOT_DIR/catppuccin-mocha-theme.png"
echo ""
echo "Or use a screenshot tool now and save the image."
echo ""
echo "Press ENTER when you've taken the screenshot (or wait 30s)..."

# Wait for user or timeout
read -t 30 || true

echo ""
echo "Cleaning up..."
tmux send-keys -t "$SESSION_NAME" "q"
sleep 3

# Clean up any leaked sessions
tmux list-sessions 2>/dev/null | grep -E "claude-live-|codex-live-" | cut -d: -f1 | xargs -I {} tmux kill-session -t {} 2>/dev/null || true

echo ""
echo "=========================================="
echo "Color Verification"
echo "=========================================="
echo ""
echo "Expected colors (Catppuccin Mocha):"
echo "  Background: #1e1e2e (dark purple-grey)"
echo "  Text:       #cdd6f4 (light blue-white)"
echo ""
echo "The background should match your Ghostty terminal's"
echo "Catppuccin Mocha theme background."
echo ""
echo "Test complete!"
