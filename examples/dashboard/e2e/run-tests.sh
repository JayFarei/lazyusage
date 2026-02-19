#!/usr/bin/env bash
# E2E browser tests for the lazyusage dashboard using agent-browser.
#
# Usage (from repo root):
#   bash examples/dashboard/e2e/run-tests.sh
#
# Requirements:
#   - npx agent-browser (auto-installed via npx)
#   - bun (for the lazyusage server)
#   - npm (for the Vite dev server)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DASHBOARD_DIR="$REPO_ROOT/examples/dashboard"
API_PORT=8092
VITE_PORT=5176
PASS=0
FAIL=0

# ── Colour helpers ────────────────────────────────────────────────────────────
green()  { echo -e "\033[32m✓ $*\033[0m"; }
red()    { echo -e "\033[31m✗ $*\033[0m"; }
header() { echo -e "\n\033[1m$*\033[0m"; }

assert() {
  local name="$1" result="$2" expected="$3"
  if echo "$result" | grep -q "$expected"; then
    green "PASS  $name"
    PASS=$((PASS + 1))
  else
    red   "FAIL  $name  (expected to contain: $expected)"
    red   "      got: $result"
    FAIL=$((FAIL + 1))
  fi
}

assert_not() {
  local name="$1" result="$2" unexpected="$3"
  if echo "$result" | grep -qv "$unexpected"; then
    green "PASS  $name"
    PASS=$((PASS + 1))
  else
    red   "FAIL  $name  (expected NOT to contain: $unexpected)"
    FAIL=$((FAIL + 1))
  fi
}

# ── Start servers ─────────────────────────────────────────────────────────────
header "Starting servers"

cd "$REPO_ROOT"
bun dist/cli.js usage --serve --port "$API_PORT" &
API_PID=$!

cd "$DASHBOARD_DIR"
npm run dev -- --port "$VITE_PORT" &>/dev/null &
VITE_PID=$!

cleanup() {
  kill "$API_PID" "$VITE_PID" 2>/dev/null || true
  npx agent-browser close 2>/dev/null || true
  echo ""
  header "Results: $PASS passed, $FAIL failed"
  [[ $FAIL -eq 0 ]] && exit 0 || exit 1
}
trap cleanup EXIT INT TERM

echo "  lazyusage server: http://localhost:$API_PORT"
echo "  Vite dev server:  http://localhost:$VITE_PORT"
echo "  Waiting for servers..."
sleep 5

# ── Test suite ────────────────────────────────────────────────────────────────
header "Loading dashboard"
npx agent-browser open "http://localhost:$VITE_PORT/?port=$API_PORT" >/dev/null
npx agent-browser wait 7000 >/dev/null

header "Test 1: Page title"
TITLE=$(npx agent-browser get title 2>&1)
assert "Page title is 'lazyusage dashboard'" "$TITLE" "lazyusage dashboard"

header "Test 2: Connected status"
BODY=$(npx agent-browser get text body 2>&1)
assert "Banner shows 'Connected'" "$BODY" "Connected"

header "Test 3: Service cards render"
assert "Claude service card present" "$BODY" "claude"
assert "Codex service card present"  "$BODY" "codex"

header "Test 4: Metric bars have percentages"
assert "Session metric shown"   "$BODY" "session"
assert "Percentage label shown" "$BODY" "% used"

header "Test 5: Bar colors (eval)"
COLORS=$(npx agent-browser eval --stdin <<'EVALEOF'
(function() {
  var bars = Array.from(document.querySelectorAll('.h-full.rounded-full'));
  var colors = bars.map(function(b) { return b.className.split(' ').find(function(c) { return c.startsWith('bg-'); }); });
  var widths = bars.map(function(b) { return b.style.width; });
  return JSON.stringify({colors: colors, widths: widths});
})()
EVALEOF
)
assert "At least one green bar (< 70% used)" "$COLORS" "bg-green-500"
assert "All widths contain % unit"           "$COLORS" "%"

header "Test 6: Resets labels present"
assert "Resets label visible" "$BODY" "Resets:"

header "Test 7: Last-updated timestamp in header"
assert "Last updated timestamp shown" "$BODY" "Last updated:"

npx agent-browser screenshot >/dev/null
green "Screenshot saved (connected state)"

header "Test 8: Port input shows current port"
PORT_VAL=$(npx agent-browser eval 'document.querySelector("#port-input")?.value' 2>&1)
assert "Port input shows $API_PORT" "$PORT_VAL" "$API_PORT"

header "Test 9: Error state on bad port"
npx agent-browser snapshot -i >/dev/null
npx agent-browser fill e1 "19999" >/dev/null
npx agent-browser press Tab >/dev/null
npx agent-browser wait 7000 >/dev/null

ERROR_BODY=$(npx agent-browser get text body 2>&1)
assert "Error banner shown"                    "$ERROR_BODY" "Error"
assert "Error message mentions port"           "$ERROR_BODY" "19999"
assert "Error message includes bun run hint"   "$ERROR_BODY" "bun run lazyusage"
assert "Previous data still visible on error"  "$ERROR_BODY" "claude"

npx agent-browser screenshot >/dev/null
green "Screenshot saved (error state)"

header "Test 10: Reconnects after port restored"
npx agent-browser fill e1 "$API_PORT" >/dev/null
npx agent-browser press Tab >/dev/null
npx agent-browser wait 8000 >/dev/null

RECONNECT_BODY=$(npx agent-browser get text body 2>&1)
assert "Re-connected after port restored" "$RECONNECT_BODY" "Connected"
assert "Data reappears after reconnect"  "$RECONNECT_BODY" "% used"

# cleanup trap handles summary + exit
