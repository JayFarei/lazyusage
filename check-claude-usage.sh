#!/bin/bash

# Claude Usage Monitor
# Launches Claude CLI in tmux, executes /usage, and displays compact statistics

# Parse command line arguments
DEBUG=false
if [[ "$1" == "--debug" ]]; then
    DEBUG=true
fi

# Start timing
START_TIME=$(date +%s.%N)

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed. Please install tmux first."
    exit 1
fi

# Check if claude CLI is available
if ! command -v claude &> /dev/null; then
    echo "Error: claude CLI is not in PATH. Please ensure it's installed."
    exit 1
fi

# Generate unique tmux session name
SESSION_NAME="claude_usage_$$_$(date +%s)"

# Create detached tmux session with claude CLI
tmux new-session -d -s "$SESSION_NAME" claude

# Wait for session to initialize
sleep 1

# Send Enter to accept the trust prompt (option 1 is default)
tmux send-keys -t "$SESSION_NAME" Enter

# Wait for prompt to clear and UI to stabilize
sleep 2

# Type /usage slowly to avoid autocomplete issues
tmux send-keys -t "$SESSION_NAME" "/"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "u"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "s"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "a"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "g"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "e"
sleep 0.2

# Press Enter to execute
tmux send-keys -t "$SESSION_NAME" Enter

# Wait for command to execute and output to appear
sleep 4

# Capture the pane output
OUTPUT=$(tmux capture-pane -t "$SESSION_NAME" -p)

# Kill the tmux session
tmux kill-session -t "$SESSION_NAME" 2>/dev/null

# Parse the output
# Extract session percentage
SESSION_PCT=$(echo "$OUTPUT" | grep -A 1 "Current session" | grep "% used" | sed -E 's/.*[[:space:]]([0-9]+)% used.*/\1/')

# Extract session reset time
SESSION_RESET=$(echo "$OUTPUT" | grep -A 2 "Current session" | grep "Resets" | sed -E 's/.*Resets[[:space:]]+([^(]+).*/\1/' | xargs)

# Extract week (all models) percentage
WEEK_ALL_PCT=$(echo "$OUTPUT" | grep -A 1 "Current week (all models)" | grep "% used" | sed -E 's/.*[[:space:]]([0-9]+)% used.*/\1/')

# Extract week (all models) reset time
WEEK_ALL_RESET=$(echo "$OUTPUT" | grep -A 2 "Current week (all models)" | grep "Resets" | sed -E 's/.*Resets[[:space:]]+([^(]+).*/\1/' | xargs)

# Extract week (Sonnet only) percentage
WEEK_SONNET_PCT=$(echo "$OUTPUT" | grep -A 1 "Current week (Sonnet only)" | grep "% used" | sed -E 's/.*[[:space:]]([0-9]+)% used.*/\1/')

# Extract week (Sonnet only) reset time
WEEK_SONNET_RESET=$(echo "$OUTPUT" | grep -A 2 "Current week (Sonnet only)" | grep "Resets" | sed -E 's/.*Resets[[:space:]]+([^(]+).*/\1/' | xargs)

# Apply fallback logic for session metric (5-hour window)
if [[ -z "$SESSION_PCT" ]]; then
    SESSION_PCT="0"
fi
if [[ -z "$SESSION_RESET" ]]; then
    SESSION_RESET=$(date -v+5H "+%-I:%M%p" | tr '[:upper:]' '[:lower:]' | sed 's/\.//g')
fi
SESSION_REMAINING=$((100 - SESSION_PCT))

# Apply fallback logic for week (all models) metric (7-day window)
if [[ -z "$WEEK_ALL_PCT" ]]; then
    WEEK_ALL_PCT="0"
fi
if [[ -z "$WEEK_ALL_RESET" ]]; then
    WEEK_ALL_RESET=$(date -v+7d "+%b %-d at %-I:%M%p" | sed -e 's/\.//g' -e 's/AM/am/' -e 's/PM/pm/')
fi
WEEK_ALL_REMAINING=$((100 - WEEK_ALL_PCT))

# Apply fallback logic for week (Sonnet only) metric (7-day window)
if [[ -z "$WEEK_SONNET_PCT" ]]; then
    WEEK_SONNET_PCT="0"
fi
if [[ -z "$WEEK_SONNET_RESET" ]]; then
    WEEK_SONNET_RESET=$(date -v+7d "+%b %-d at %-I:%M%p" | sed -e 's/\.//g' -e 's/AM/am/' -e 's/PM/pm/')
fi
WEEK_SONNET_REMAINING=$((100 - WEEK_SONNET_PCT))

# Format and output compact single-line statistics with both used and remaining percentages
echo "Session: ${SESSION_PCT}% used (${SESSION_REMAINING}% remaining) (resets ${SESSION_RESET}) | Weekly: ${WEEK_ALL_PCT}% used (${WEEK_ALL_REMAINING}% remaining) (resets ${WEEK_ALL_RESET}) | Sonnet: ${WEEK_SONNET_PCT}% used (${WEEK_SONNET_REMAINING}% remaining) (resets ${WEEK_SONNET_RESET})"

# Output timing if debug mode is enabled
if [[ "$DEBUG" == "true" ]]; then
    END_TIME=$(date +%s.%N)
    DURATION=$(echo "$END_TIME - $START_TIME" | bc)
    echo "[DEBUG] Execution time: ${DURATION}s"
fi
