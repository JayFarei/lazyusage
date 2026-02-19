#!/bin/bash
# Complete agentic capacity management loop (bash version).
#
# Combines all SKILL.md scenarios: pre-flight check, adaptive throttling,
# service failover, and sleep-until-reset.
#
# Requires: jq (brew install jq)
# Usage:    ./examples/agent_integration.sh [claude|codex]

set -euo pipefail

SERVICE="${1:-claude}"

check_jq() {
  command -v jq &>/dev/null || { echo "Error: jq required (brew install jq)"; exit 1; }
}

fetch() {
  local svc="${1:-}"
  if [ -n "$svc" ]; then
    bun run --cwd "$(dirname "$0")/.." usage:dev "$svc" --json 2>/dev/null
  else
    bun run --cwd "$(dirname "$0")/.." usage:dev --json 2>/dev/null
  fi
}

tightest() {
  echo "$1" | jq -r \
    ".services[] | select(.name == \"$2\" and .available) | .metrics | min_by(.remaining_pct)"
}

seconds_until_reset() {
  local resets="$1"
  if echo "$resets" | grep -qE '^[0-9]{1,2}:[0-9]{2}(am|pm)$'; then
    local target now diff
    target=$(date -j -f "%I:%M%p" "$resets" "+%s" 2>/dev/null || echo "0")
    now=$(date "+%s")
    diff=$((target - now))
    [ "$diff" -le 0 ] && diff=$((diff + 86400))
    echo "$diff"
  else
    echo 3600
  fi
}

# -- main --------------------------------------------------------------------

check_jq

for attempt in 1 2 3; do
  echo ""
  echo "--- Attempt $attempt ---"

  json=$(fetch "$SERVICE")
  metric=$(tightest "$json" "$SERVICE")

  if [ "$metric" = "null" ] || [ -z "$metric" ]; then
    echo "$SERVICE not available."
    exit 1
  fi

  name=$(echo "$metric" | jq -r '.name')
  remaining=$(echo "$metric" | jq -r '.remaining_pct')
  resets=$(echo "$metric" | jq -r '.resets')

  echo "Tightest: $name ${remaining}% (resets $resets)"

  # green
  if [ "$remaining" -ge 50 ]; then
    echo "[green] Full speed. Proceeding."
    exit 0
  fi

  # yellow
  if [ "$remaining" -ge 20 ]; then
    echo "[yellow] Throttling: fewer agents, smaller context."
    exit 0
  fi

  # red - try failover
  echo "[red] Capacity low."
  alt=""
  [ "$SERVICE" = "claude" ] && alt="codex"
  [ "$SERVICE" = "codex" ] && alt="claude"

  if [ -n "$alt" ]; then
    alt_json=$(fetch "$alt")
    alt_metric=$(tightest "$alt_json" "$alt")
    alt_remaining=$(echo "$alt_metric" | jq -r '.remaining_pct // 0')
    if [ "$alt_remaining" -ge 20 ]; then
      echo "Failing over to $alt (${alt_remaining}% remaining)."
      exit 0
    fi
  fi

  # red - sleep until reset
  if [ "$attempt" -lt 3 ]; then
    wait_secs=$(seconds_until_reset "$resets")
    echo "Sleeping $((wait_secs / 60 + 1)) min until $resets..."
    sleep "$wait_secs"
  else
    echo "Max retries reached."
    exit 1
  fi
done
