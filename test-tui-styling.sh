#!/bin/bash
# Test TUI styling changes

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

source venv/bin/activate

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}TUI Styling Test${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

SESSION_NAME="test-tui-styling-$$"

echo -e "${YELLOW}Launching TUI...${NC}"
tmux new-session -d -s "$SESSION_NAME" "source venv/bin/activate && usage tui --refresh 10"

# Wait for TUI to initialize
echo -e "${YELLOW}Waiting 10s for initialization...${NC}"
sleep 10

# Capture output
echo -e "${YELLOW}Capturing TUI output...${NC}"
OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p -e)

# Kill session
tmux send-keys -t "$SESSION_NAME" "q"
sleep 2

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Verification Results${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Test 1: Check for consistent "Session (5h)" labels
echo -e "${YELLOW}[TEST 1] Label Consistency${NC}"
if echo "$OUTPUT" | grep -q "Session (5h)"; then
    echo -e "${GREEN}✓ PASS: Found 'Session (5h)' label${NC}"
else
    echo -e "${RED}✗ FAIL: 'Session (5h)' label not found${NC}"
    echo "Output:"
    echo "$OUTPUT"
fi
echo ""

# Test 2: Check for progress bars
echo -e "${YELLOW}[TEST 2] Progress Bar Rendering${NC}"
if echo "$OUTPUT" | grep -qE '[▓░]'; then
    echo -e "${GREEN}✓ PASS: Progress bars rendering${NC}"
else
    echo -e "${RED}✗ FAIL: Progress bars not found${NC}"
fi
echo ""

# Test 3: Verify JSON option removed from footer
echo -e "${YELLOW}[TEST 3] JSON Option Removed${NC}"
if echo "$OUTPUT" | grep -q "JSON"; then
    echo -e "${RED}✗ FAIL: 'JSON' still appears in output${NC}"
    echo "Found JSON in output"
else
    echo -e "${GREEN}✓ PASS: 'JSON' option removed from footer${NC}"
fi
echo ""

# Test 4: Check for both panels
echo -e "${YELLOW}[TEST 4] Panel Structure${NC}"
CLAUDE_FOUND=false
CODEX_FOUND=false

if echo "$OUTPUT" | grep -q "Claude Usage"; then
    echo -e "${GREEN}✓ Claude Usage panel found${NC}"
    CLAUDE_FOUND=true
else
    echo -e "${RED}✗ Claude Usage panel not found${NC}"
fi

if echo "$OUTPUT" | grep -q "Codex Usage"; then
    echo -e "${GREEN}✓ Codex Usage panel found${NC}"
    CODEX_FOUND=true
else
    echo -e "${RED}✗ Codex Usage panel not found${NC}"
fi
echo ""

# Test 5: Check for Weekly labels
echo -e "${YELLOW}[TEST 5] Weekly Labels${NC}"
if echo "$OUTPUT" | grep -q "Weekly"; then
    echo -e "${GREEN}✓ PASS: Weekly labels found${NC}"
else
    echo -e "${RED}✗ FAIL: Weekly labels not found${NC}"
fi
echo ""

# Test 6: Verify footer shortcuts
echo -e "${YELLOW}[TEST 6] Footer Shortcuts${NC}"
SHORTCUTS_OK=true

if echo "$OUTPUT" | grep -q "Refresh"; then
    echo -e "${GREEN}✓ Refresh shortcut present${NC}"
else
    echo -e "${RED}✗ Refresh shortcut missing${NC}"
    SHORTCUTS_OK=false
fi

if echo "$OUTPUT" | grep -q "Pause"; then
    echo -e "${GREEN}✓ Pause shortcut present${NC}"
else
    echo -e "${RED}✗ Pause shortcut missing${NC}"
    SHORTCUTS_OK=false
fi

if echo "$OUTPUT" | grep -q "Quit"; then
    echo -e "${GREEN}✓ Quit shortcut present${NC}"
else
    echo -e "${RED}✗ Quit shortcut missing${NC}"
    SHORTCUTS_OK=false
fi
echo ""

# Cleanup
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
sleep 1

# Clean up any leaked sessions
echo -e "${BLUE}Cleaning up collector sessions...${NC}"
tmux list-sessions 2>/dev/null | grep -E "claude-live-|codex-live-" | cut -d: -f1 | xargs -I {} tmux kill-session -t {} 2>/dev/null || true

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Visual Sample${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Here's a sample of the TUI output:"
echo "$OUTPUT" | head -30
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}TUI Styling Test Complete${NC}"
echo -e "${GREEN}========================================${NC}"
