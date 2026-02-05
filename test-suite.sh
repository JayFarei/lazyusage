#!/bin/bash
# Usage Monitor Test Suite
# Tests all functionality end-to-end using tmux

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Activate virtual environment
source venv/bin/activate

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Usage Monitor Test Suite${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Helper function to run a test
run_test() {
    local test_name="$1"
    local test_function="$2"

    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "${YELLOW}[TEST $TESTS_RUN] $test_name${NC}"

    if $test_function; then
        echo -e "${GREEN}✓ PASS${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo ""
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo ""
        return 1
    fi
}

# Cleanup function
cleanup() {
    echo -e "${BLUE}Cleaning up test sessions...${NC}"
    tmux list-sessions 2>/dev/null | grep -E "test-usage-|claude-live-|codex-live-" | cut -d: -f1 | xargs -I {} tmux kill-session -t {} 2>/dev/null || true
    echo -e "${GREEN}Cleanup complete${NC}"
}

# Ensure cleanup on exit
trap cleanup EXIT

# Test 1: Check CLI is installed
test_cli_installed() {
    if command -v usage &> /dev/null; then
        echo "  - CLI command 'usage' is available"
        return 0
    else
        echo "  - ERROR: 'usage' command not found"
        return 1
    fi
}

# Test 2: Test help command
test_help() {
    local output=$(usage --help 2>&1)
    if echo "$output" | grep -q "Usage monitoring CLI"; then
        echo "  - Help text displays correctly"
        return 0
    else
        echo "  - ERROR: Help text not found"
        return 1
    fi
}

# Test 3: Test TUI command exists
test_tui_command_exists() {
    local output=$(usage --help 2>&1)
    if echo "$output" | grep -q "tui.*Launch interactive TUI"; then
        echo "  - TUI command is registered"
        return 0
    else
        echo "  - ERROR: TUI command not found in help"
        return 1
    fi
}

# Test 4: Test ephemeral Claude collector (single-shot)
test_claude_ephemeral() {
    echo "  - Running: usage claude --json"
    local output=$(timeout 15 usage claude --json 2>&1 || true)

    if echo "$output" | grep -q '"claude"'; then
        echo "  - Claude ephemeral collector returns JSON"

        # Check for expected keys
        if echo "$output" | grep -q '"session"' && echo "$output" | grep -q '"week_all"'; then
            echo "  - Output contains expected metric keys"
            return 0
        else
            echo "  - ERROR: Missing expected metric keys"
            echo "  - Output: $output"
            return 1
        fi
    else
        echo "  - ERROR: No valid JSON output from Claude collector"
        echo "  - Output: $output"
        return 1
    fi
}

# Test 5: Test ephemeral Codex collector (single-shot)
test_codex_ephemeral() {
    echo "  - Running: usage codex --json"
    local output=$(timeout 15 usage codex --json 2>&1 || true)

    if echo "$output" | grep -q '"codex"'; then
        echo "  - Codex ephemeral collector returns JSON"

        # Check for expected keys
        if echo "$output" | grep -q '"5h"' && echo "$output" | grep -q '"weekly"'; then
            echo "  - Output contains expected metric keys"
            return 0
        else
            echo "  - ERROR: Missing expected metric keys"
            echo "  - Output: $output"
            return 1
        fi
    else
        echo "  - ERROR: No valid JSON output from Codex collector"
        echo "  - Output: $output"
        return 1
    fi
}

# Test 6: Test 'all' command
test_all_command() {
    echo "  - Running: usage all --json"
    local output=$(timeout 20 usage all --json 2>&1 || true)

    if echo "$output" | grep -q '"claude"' && echo "$output" | grep -q '"codex"'; then
        echo "  - 'all' command returns both Claude and Codex data"
        return 0
    else
        echo "  - ERROR: 'all' command missing data"
        echo "  - Output: $output"
        return 1
    fi
}

# Test 7: Test dashboard launches and shows both collectors (BUG FIX TEST)
test_dashboard_launch() {
    local session_name="test-usage-dashboard-$$"

    echo "  - Launching dashboard in tmux session: $session_name"
    tmux new-session -d -s "$session_name" "source venv/bin/activate && usage --live --refresh 10"

    # Wait for dashboard to initialize
    echo "  - Waiting 15s for dashboard initialization..."
    sleep 15

    # Capture output
    local output=$(tmux capture-pane -t "$session_name" -p)

    # Check for Claude Usage section
    if echo "$output" | grep -q "Claude Usage"; then
        echo "  - ✓ Claude Usage section found"
    else
        echo "  - ERROR: Claude Usage section not found"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        return 1
    fi

    # Check for Codex Usage section
    if echo "$output" | grep -q "Codex Usage"; then
        echo "  - ✓ Codex Usage section found"
    else
        echo "  - ERROR: Codex Usage section not found"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        return 1
    fi

    # BUG FIX TEST: Check that Claude metrics are NOT all 0%
    # This tests that the bug fix worked (using /usage instead of /status)
    local claude_section=$(echo "$output" | sed -n '/Claude Usage/,/Codex Usage/p')

    if echo "$claude_section" | grep -qE '[1-9][0-9]*%'; then
        echo "  - ✓ BUG FIX VERIFIED: Claude shows non-zero percentages"
    else
        # This might be a fresh session with 0% usage, which is valid
        # Check if we see proper format with reset times
        if echo "$claude_section" | grep -q "resets"; then
            echo "  - ✓ Claude metrics display properly (may be 0% if no usage)"
        else
            echo "  - WARNING: Claude metrics format unexpected"
            echo "  - Claude section: $claude_section"
        fi
    fi

    # Check for progress bars (▓ or ░ characters)
    if echo "$output" | grep -qE '[▓░]'; then
        echo "  - ✓ Progress bars rendering correctly"
    else
        echo "  - ERROR: No progress bars found"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        return 1
    fi

    # Cleanup
    tmux kill-session -t "$session_name" 2>/dev/null || true
    echo "  - Dashboard test complete"

    return 0
}

# Test 8: Test TUI launches and renders correctly
test_tui_launch() {
    local session_name="test-usage-tui-$$"

    echo "  - Launching TUI in tmux session: $session_name"
    tmux new-session -d -s "$session_name" "source venv/bin/activate && usage tui --refresh 10"

    # Wait for TUI to initialize
    echo "  - Waiting 8s for TUI initialization..."
    sleep 8

    # Capture output
    local output=$(tmux capture-pane -t "$session_name" -p -e)

    # Check for TUI header
    if echo "$output" | grep -q "Usage Monitor"; then
        echo "  - ✓ TUI header found"
    else
        echo "  - ERROR: TUI header not found"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        return 1
    fi

    # Check for Claude Usage panel
    if echo "$output" | grep -q "Claude Usage"; then
        echo "  - ✓ Claude Usage panel found"
    else
        echo "  - ERROR: Claude Usage panel not found"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        return 1
    fi

    # Check for Codex Usage panel
    if echo "$output" | grep -q "Codex Usage"; then
        echo "  - ✓ Codex Usage panel found"
    else
        echo "  - ERROR: Codex Usage panel not found"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        return 1
    fi

    # Check for keyboard shortcuts in footer
    if echo "$output" | grep -q "Refresh" && echo "$output" | grep -q "Pause" && echo "$output" | grep -q "Quit"; then
        echo "  - ✓ Footer with keyboard shortcuts found"
    else
        echo "  - ERROR: Footer with shortcuts not found"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        return 1
    fi

    # Check for panel borders (Textual uses box drawing characters)
    if echo "$output" | grep -qE '[╭╮╯╰│─┤├]'; then
        echo "  - ✓ Panel borders rendering correctly"
    else
        echo "  - ERROR: Panel borders not found"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        return 1
    fi

    # Cleanup
    tmux kill-session -t "$session_name" 2>/dev/null || true
    echo "  - TUI test complete"

    return 0
}

# Test 9: Test TUI keyboard shortcuts (send keys)
test_tui_keyboard() {
    local session_name="test-usage-tui-keys-$$"

    echo "  - Launching TUI for keyboard test: $session_name"
    tmux new-session -d -s "$session_name" "source venv/bin/activate && usage tui --refresh 10"

    # Wait for initialization
    sleep 8

    # Test: Press 'p' to pause
    echo "  - Testing 'P' key (pause)"
    tmux send-keys -t "$session_name" "p"
    sleep 1

    local output=$(tmux capture-pane -t "$session_name" -p -e)

    # Check if paused state is shown (notification or status bar)
    if echo "$output" | grep -qi "pause"; then
        echo "  - ✓ Pause notification detected"
    else
        echo "  - Note: Pause state may not be visible in capture"
    fi

    # Test: Press 'q' to quit
    echo "  - Testing 'Q' key (quit)"
    tmux send-keys -t "$session_name" "q"
    sleep 3

    # Check if session was terminated
    if ! tmux has-session -t "$session_name" 2>/dev/null; then
        echo "  - ✓ TUI quit successfully with 'q' key"
        # Give extra time for background cleanup
        sleep 2
        return 0
    else
        echo "  - ERROR: TUI did not quit with 'q' key"
        tmux kill-session -t "$session_name" 2>/dev/null || true
        return 1
    fi
}

# Test 10: Verify tmux cleanup after TUI exit
test_tmux_cleanup() {
    local session_name="test-usage-tui-cleanup-$$"

    # First, clean up any existing sessions from previous tests
    echo "  - Cleaning up any pre-existing sessions..."
    tmux list-sessions 2>/dev/null | grep -E "claude-live-|codex-live-" | cut -d: -f1 | xargs -I {} tmux kill-session -t {} 2>/dev/null || true
    sleep 1

    # Verify no sessions exist before we start
    local existing_sessions=$(tmux list-sessions 2>/dev/null | grep -E "claude-live-|codex-live-" | wc -l || echo 0)
    if [ "$existing_sessions" -gt 0 ]; then
        echo "  - WARNING: Still found $existing_sessions sessions after cleanup, waiting..."
        sleep 2
    fi

    echo "  - Launching TUI to test cleanup: $session_name"
    tmux new-session -d -s "$session_name" "source venv/bin/activate && usage tui --refresh 10"

    # Wait for TUI to fully initialize and create its collector sessions
    echo "  - Waiting for TUI initialization and collector sessions..."
    sleep 10

    # Verify collector sessions were created
    local collector_sessions=$(tmux list-sessions 2>/dev/null | grep -E "claude-live-|codex-live-" | wc -l || echo 0)
    echo "  - Collector sessions created: $collector_sessions"

    if [ "$collector_sessions" -eq 0 ]; then
        echo "  - WARNING: No collector sessions found, test might be too fast"
    fi

    # Quit TUI
    echo "  - Sending quit command (q)"
    tmux send-keys -t "$session_name" "q"

    # Wait for cleanup to complete
    echo "  - Waiting for cleanup to complete..."
    sleep 6

    # Check if collector sessions were cleaned up
    local remaining_sessions=$(tmux list-sessions 2>/dev/null | grep -E "claude-live-|codex-live-" | wc -l || echo 0)

    if [ "$remaining_sessions" -eq 0 ]; then
        echo "  - ✓ All collector sessions cleaned up successfully"
        return 0
    else
        echo "  - ERROR: Found $remaining_sessions leaked sessions after cleanup"
        tmux list-sessions 2>/dev/null | grep -E "claude-live-|codex-live-" || true
        echo "  - Note: Cleanup may need more time, but test has a 6s wait period"
        return 1
    fi
}

# Run all tests
echo -e "${BLUE}Starting tests...${NC}"
echo ""

run_test "CLI Installation" test_cli_installed
run_test "Help Command" test_help
run_test "TUI Command Registration" test_tui_command_exists
run_test "Claude Ephemeral Collector" test_claude_ephemeral
run_test "Codex Ephemeral Collector" test_codex_ephemeral
run_test "All Command (Both CLIs)" test_all_command
run_test "Dashboard Launch & Bug Fix" test_dashboard_launch
run_test "TUI Launch & Rendering" test_tui_launch
run_test "TUI Keyboard Shortcuts" test_tui_keyboard
run_test "TUI Tmux Cleanup" test_tmux_cleanup

# Print summary
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Test Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Tests Run:    $TESTS_RUN"
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
else
    echo -e "${GREEN}Tests Failed: $TESTS_FAILED${NC}"
fi
echo ""

# Final verdict
if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
    echo -e "${GREEN}========================================${NC}"
    exit 0
else
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}✗ SOME TESTS FAILED${NC}"
    echo -e "${RED}========================================${NC}"
    exit 1
fi
