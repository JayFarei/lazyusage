#!/bin/bash
# Complete agentic capacity-management loop (bash version).
#
# Defaults to an installed `lazyusage` binary. Override with:
#   LAZYUSAGE_CMD="bun run lazyusage" ./examples/agent_integration.sh

set -euo pipefail

SERVICE="${1:-claude}"
LAZYUSAGE_CMD="${LAZYUSAGE_CMD:-lazyusage}"

check_jq() {
  command -v jq >/dev/null || { echo "Error: jq required"; exit 1; }
}

fetch() {
  local svc="${1:-}"
  if [ -n "$svc" ]; then
    eval "$LAZYUSAGE_CMD" "$svc" --json 2>/dev/null
  else
    eval "$LAZYUSAGE_CMD" --json 2>/dev/null
  fi
}

tightest() {
  echo "$1" | jq -r \
    ".services[] | select(.name == \"$2\" and .available) | .metrics | min_by(.remaining_pct)"
}

service_info() {
  echo "$1" | jq -r \
    ".services[] | select(.name == \"$2\") | {source, stale, error}"
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

check_jq

for attempt in 1 2 3; do
  echo ""
  echo "--- Attempt $attempt ---"

  json=$(fetch "$SERVICE")
  metric=$(tightest "$json" "$SERVICE")
  info=$(service_info "$json" "$SERVICE")

  if [ "$metric" = "null" ] || [ -z "$metric" ]; then
    echo "$SERVICE not available."
    exit 1
  fi

  source=$(echo "$info" | jq -r '.source // "unknown"')
  stale=$(echo "$info" | jq -r '.stale')
  error=$(echo "$info" | jq -r '.error // empty')
  name=$(echo "$metric" | jq -r '.name')
  remaining=$(echo "$metric" | jq -r '.remaining_pct')
  resets=$(echo "$metric" | jq -r '.resets')

  echo "Source: $source"
  [ "$stale" = "true" ] && echo "Data is stale."
  [ -n "$error" ] && echo "Fetch warning: $error"
  echo "Tightest: $name ${remaining}% (resets $resets)"

  if [ "$source" = "fallback" ] || [ "$stale" = "true" ]; then
    echo "Confidence is degraded; avoid large fan-out."
  fi

  if [ "$remaining" -ge 50 ]; then
    echo "[green] Full speed. Proceeding."
    exit 0
  fi

  if [ "$remaining" -ge 20 ]; then
    echo "[yellow] Throttling: fewer agents, smaller context."
    exit 0
  fi

  echo "[red] Capacity low."
  alt=""
  [ "$SERVICE" = "claude" ] && alt="codex"
  [ "$SERVICE" = "codex" ] && alt="claude"

  if [ -n "$alt" ]; then
    alt_json=$(fetch "$alt")
    alt_metric=$(tightest "$alt_json" "$alt")
    alt_info=$(service_info "$alt_json" "$alt")
    alt_remaining=$(echo "$alt_metric" | jq -r '.remaining_pct // 0')
    alt_source=$(echo "$alt_info" | jq -r '.source // "unknown"')
    alt_stale=$(echo "$alt_info" | jq -r '.stale')
    if [ "$alt_remaining" -ge 20 ] && [ "$alt_source" != "fallback" ] && [ "$alt_stale" != "true" ]; then
      echo "Failing over to $alt (${alt_remaining}% remaining)."
      exit 0
    fi
  fi

  if [ "$attempt" -lt 3 ]; then
    wait_secs=$(seconds_until_reset "$resets")
    echo "Sleeping $((wait_secs / 60 + 1)) min until $resets..."
    sleep "$wait_secs"
  else
    echo "Max retries reached."
    exit 1
  fi
done
