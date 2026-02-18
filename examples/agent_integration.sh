#!/bin/bash
# Example: Check capacity before running expensive operation
#
# This demonstrates how to check Claude/Codex capacity in a bash script
# before running an expensive operation that would consume quota.

set -e

SERVICE="${1:-claude}"  # Default to claude if not specified
THRESHOLD=20            # Minimum remaining percentage

echo "Checking ${SERVICE} capacity..."

# Get JSON output (uses the monorepo root script; for global install use: usage-check "$SERVICE" --json)
json=$(bun run --cwd "$(dirname "$0")/.." usage-check "${SERVICE}" --json 2>&1)

# Check if command succeeded
if [ $? -ne 0 ]; then
    echo "✗ Error checking capacity: ${json}"
    exit 1
fi

# Extract metrics using jq (requires jq to be installed)
if ! command -v jq &> /dev/null; then
    echo "✗ Error: jq is required for this script"
    echo "Install with: brew install jq"
    exit 1
fi

# Find the most restrictive metric
most_restrictive=$(echo "$json" | jq -r \
    ".services[] | select(.name == \"${SERVICE}\" and .available == true) | .metrics | min_by(.remaining_pct)")

if [ "$most_restrictive" == "null" ] || [ -z "$most_restrictive" ]; then
    echo "✗ ${SERVICE} not available"
    exit 1
fi

# Extract metric details
metric_name=$(echo "$most_restrictive" | jq -r '.name')
remaining=$(echo "$most_restrictive" | jq -r '.remaining_pct')

echo "Most restrictive metric: ${metric_name} (${remaining}% remaining)"

# Check threshold
if [ "$remaining" -lt "$THRESHOLD" ]; then
    echo "✗ Low capacity: ${remaining}% remaining (threshold: ${THRESHOLD}%)"
    echo "Deferring operation"
    exit 1
else
    echo "✓ Capacity OK: ${remaining}% remaining"
    echo "Proceeding with operation"
    # Run expensive operation here
    # spawn_subagent
    exit 0
fi
