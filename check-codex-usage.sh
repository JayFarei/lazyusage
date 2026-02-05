#!/bin/bash

# Parse command line arguments
DEBUG=false
if [[ "$1" == "--debug" ]]; then
    DEBUG=true
fi

# Start timing
START_TIME=$(date +%s.%N)

# Check prerequisites
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is not installed. Please install tmux first."
    exit 1
fi

if ! command -v codex &> /dev/null; then
    echo "Error: codex CLI is not in PATH. Please ensure Codex CLI is installed."
    exit 1
fi

# Generate unique tmux session name
SESSION_NAME="codex-usage-$$-$(date +%s)"

# Start tmux session with codex CLI (detached)
tmux new-session -d -s "$SESSION_NAME" "codex"

# Wait for session to initialize
sleep 2

# Type /status character-by-character to avoid autocomplete
tmux send-keys -t "$SESSION_NAME" "/"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "s"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "t"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "a"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "t"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "u"
sleep 0.2
tmux send-keys -t "$SESSION_NAME" "s"
sleep 0.2

# Press Enter to execute
tmux send-keys -t "$SESSION_NAME" Enter

# Wait for command to execute
sleep 3

# Capture output
OUTPUT=$(tmux capture-pane -p -t "$SESSION_NAME")

# Kill tmux session
tmux kill-session -t "$SESSION_NAME" 2>/dev/null

# Parse 5h limit
FIVE_H_LEFT=$(echo "$OUTPUT" | grep "5h limit:" | sed -E 's/.*[[:space:]]([0-9]+)% left.*/\1/')
FIVE_H_RESET_RAW=$(echo "$OUTPUT" | grep "5h limit:" | sed -E 's/.*resets[[:space:]]+([^)]+).*/\1/' | xargs)

# Convert 24-hour time to 12-hour format (e.g., "14:31" → "2:31pm")
if [[ -n "$FIVE_H_RESET_RAW" ]]; then
    # Extract hour and minute
    HOUR=$(echo "$FIVE_H_RESET_RAW" | cut -d':' -f1)
    MINUTE=$(echo "$FIVE_H_RESET_RAW" | cut -d':' -f2)
    # Convert to 12-hour format with am/pm and remove dots from am/pm
    FIVE_H_RESET=$(date -j -f "%H:%M" "${HOUR}:${MINUTE}" "+%-I:%M%p" | tr '[:upper:]' '[:lower:]' | sed 's/\.//g')
else
    FIVE_H_RESET=""
fi

# Parse weekly limit - the reset time is on the next line
WEEKLY_LEFT=$(echo "$OUTPUT" | grep -i "weekly limit:" | sed -E 's/.*[[:space:]]([0-9]+)% left.*/\1/')

# Get the line after "Weekly limit:" which contains the reset time
WEEKLY_LINE=$(echo "$OUTPUT" | grep -i -n "weekly limit:" | cut -d: -f1)
if [[ -n "$WEEKLY_LINE" ]]; then
    NEXT_LINE=$((WEEKLY_LINE + 1))
    WEEKLY_RESET_RAW=$(echo "$OUTPUT" | sed -n "${NEXT_LINE}p" | sed -E 's/.*resets[[:space:]]+([^)]+).*/\1/' | xargs)
else
    WEEKLY_RESET_RAW=""
fi

# Convert 24-hour time to 12-hour format (e.g., "20:19 on 9 Feb" → "8:19pm on Feb 9")
if [[ -n "$WEEKLY_RESET_RAW" ]]; then
    # Extract time and date parts (format: "HH:MM on D Mon")
    TIME_PART=$(echo "$WEEKLY_RESET_RAW" | sed -E 's/^([0-9:]+).*/\1/')
    DATE_PART=$(echo "$WEEKLY_RESET_RAW" | sed -E 's/.*on[[:space:]]+(.*)$/\1/')

    # Convert time to 12-hour format and remove dots from am/pm
    HOUR=$(echo "$TIME_PART" | cut -d':' -f1)
    MINUTE=$(echo "$TIME_PART" | cut -d':' -f2)
    TIME_12H=$(date -j -f "%H:%M" "${HOUR}:${MINUTE}" "+%-I:%M%p" | tr '[:upper:]' '[:lower:]' | sed 's/\.//g')

    # Reformat date (e.g., "9 Feb" → "Feb 9 at 8:19pm")
    DAY=$(echo "$DATE_PART" | awk '{print $1}')
    MONTH=$(echo "$DATE_PART" | awk '{print $2}')
    WEEKLY_RESET="${MONTH} ${DAY} at ${TIME_12H}"
else
    WEEKLY_RESET=""
fi

# Apply fallback logic for 5h limit
if [[ -z "$FIVE_H_LEFT" ]]; then
    FIVE_H_LEFT="100"
fi
if [[ -z "$FIVE_H_RESET" ]]; then
    FIVE_H_RESET=$(date -v+5H "+%-I:%M%p" | tr '[:upper:]' '[:lower:]' | sed 's/\.//g')
fi
FIVE_H_USED=$((100 - FIVE_H_LEFT))
FIVE_H_REMAINING=$FIVE_H_LEFT

# Apply fallback logic for weekly limit
if [[ -z "$WEEKLY_LEFT" ]]; then
    WEEKLY_LEFT="100"
fi
if [[ -z "$WEEKLY_RESET" ]]; then
    # Format: "Feb 12 at 8:19pm" (capitalize month, use "at", lowercase am/pm)
    WEEKLY_RESET=$(date -v+7d "+%b %-d at %-I:%M%p" | sed -e 's/\.//g' -e 's/AM/am/' -e 's/PM/pm/')
fi
WEEKLY_USED=$((100 - WEEKLY_LEFT))
WEEKLY_REMAINING=$WEEKLY_LEFT

# Format and output compact single-line statistics
echo "5h: ${FIVE_H_USED}% used (${FIVE_H_REMAINING}% remaining) (resets ${FIVE_H_RESET}) | Weekly: ${WEEKLY_USED}% used (${WEEKLY_REMAINING}% remaining) (resets ${WEEKLY_RESET})"

# Output timing if debug mode is enabled
if [[ "$DEBUG" == "true" ]]; then
    END_TIME=$(date +%s.%N)
    DURATION=$(echo "$END_TIME - $START_TIME" | bc)
    echo "[DEBUG] Execution time: ${DURATION}s"
fi
