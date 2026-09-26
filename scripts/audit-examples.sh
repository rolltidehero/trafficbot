#!/bin/bash
# Automated audit of all run-examples.sh configurations (non-interactive, non-Tor).
# Each test runs in a subshell with explicit exports so they override .env values.

PASS=0
FAIL=0
SKIP=0
RESULTS=()
PORT=3100
NODE="$(which node)"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$PROJ/dist/main.js"
REDIS_URL="redis://127.0.0.1:6379"

flush_redis() {
  docker exec trafficbot-redis-1 redis-cli FLUSHALL > /dev/null 2>&1 || true
}

# run_with_timeout <seconds> <cmd...>
# Returns 0 on normal exit, 124 on timeout, otherwise the cmd exit code.
run_with_timeout() {
  local secs="$1"; shift
  "$@" &
  local pid=$!
  ( sleep "$secs"; kill "$pid" 2>/dev/null ) &
  local watcher=$!
  wait "$pid" 2>/dev/null
  local rc=$?
  kill "$watcher" 2>/dev/null
  wait "$watcher" 2>/dev/null
  return $rc
}

run_test() {
  local name="$1"
  local timeout_sec="$2"
  shift 2
  # Remaining: KEY=value overrides (space-separated)

  PORT=$((PORT + 1))
  pkill -f "$DIST" 2>/dev/null; sleep 0.5

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶  $name  [port $PORT, timeout ${timeout_sec}s]"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Run in subshell: source .env first, then apply overrides
  output=$(
    (
      cd "$PROJ"
      # Load .env values as baseline
      set -o allexport
      [ -f .env ] && source .env
      set +o allexport
      # Apply per-test overrides (they must override .env)
      export REDIS_URL="$REDIS_URL"
      export HEALTH_PORT="$PORT"
      export HEADLESS=true
      export SESSION_TIME=0.1
      export EXTERNAL_IP_CHECK=false
      # Apply caller's additional overrides
      for kv in "$@"; do export "$kv"; done
      run_with_timeout "$timeout_sec" "$NODE" "$DIST"
    ) 2>&1
  )
  local exit_code=$?

  if [ $exit_code -eq 143 ] || [ $exit_code -eq 137 ]; then
    # SIGTERM/SIGKILL from our watcher = timeout
    if echo "$output" | grep -q "Session completed successfully"; then
      echo "✅ PASS (timed out — expected for long-running; sessions ran ok)"
      PASS=$((PASS+1)); RESULTS+=("✅ $name")
    else
      echo "❌ FAIL (timed out, no successful session)"
      echo "$output" | grep -E "error:|Execution failed" | tail -6
      FAIL=$((FAIL+1)); RESULTS+=("❌ $name (timeout, no sessions)")
    fi
  elif echo "$output" | grep -q "Session completed successfully"; then
    echo "✅ PASS"
    PASS=$((PASS+1)); RESULTS+=("✅ $name")
  elif echo "$output" | grep -qE "wait.*[1-9]|bull:traffic"; then
    # Producer mode: jobs were enqueued (verify via redis)
    local queued
    queued=$(docker exec trafficbot-redis-1 redis-cli LLEN "bull:traffic-sessions:wait" 2>/dev/null || echo 0)
    if [ "$queued" -gt 0 ] 2>/dev/null; then
      echo "✅ PASS (producer — $queued jobs enqueued)"
      PASS=$((PASS+1)); RESULTS+=("✅ $name")
    else
      echo "❌ FAIL (exit $exit_code — no sessions, no queued jobs)"
      echo "$output" | grep -E "error:|Execution failed" | tail -6
      FAIL=$((FAIL+1)); RESULTS+=("❌ $name (no sessions/jobs)")
    fi
  elif [ $exit_code -eq 0 ]; then
    # Producer exits 0 — check Redis
    local queued
    queued=$(docker exec trafficbot-redis-1 redis-cli LLEN "bull:traffic-sessions:wait" 2>/dev/null || echo 0)
    if [ "$queued" -gt 0 ] 2>/dev/null; then
      echo "✅ PASS (producer — $queued jobs enqueued)"
      PASS=$((PASS+1)); RESULTS+=("✅ $name")
    else
      echo "❌ FAIL (exit 0 but no successful session or jobs found)"
      echo "$output" | grep -E "error:|warn:" | tail -6
      FAIL=$((FAIL+1)); RESULTS+=("❌ $name (exit 0, nothing ran)")
    fi
  else
    echo "❌ FAIL (exit $exit_code)"
    echo "$output" | grep -E "error:|Execution failed" | tail -6
    FAIL=$((FAIL+1)); RESULTS+=("❌ $name (exit $exit_code)")
  fi
}

skip_test() {
  echo ""; echo "⏭  SKIP: $1 ($2)"
  SKIP=$((SKIP+1)); RESULTS+=("⏭ $1 (skipped: $2)")
}

# ─── Build ────────────────────────────────────────────────────────────────────
cd "$PROJ"
echo "Building dist..."
npm run build --silent
echo "node: $NODE  |  dist: $DIST"
echo ""
echo "=================================================="
echo "  RUNNING EXAMPLE AUDITS"
echo "=================================================="

# ── 1) Default Production Run ─────────────────────────────────────────────────
flush_redis
run_test "1) Default Production Run" 30 \
  "NODE_ENV=production" "BOT_ROLE=both" "MAX_SESSIONS=1"

# ── 2) High Concurrency ───────────────────────────────────────────────────────
flush_redis
run_test "2) High Concurrency (3 sessions)" 50 \
  "NODE_ENV=production" "BOT_ROLE=both" "MAX_SESSIONS=3"

# ── 3) Targeted URL ───────────────────────────────────────────────────────────
flush_redis
run_test "3) Targeted URL (ppplayer.com)" 30 \
  "NODE_ENV=production" "BOT_ROLE=both" "MAX_SESSIONS=1" "DEFAULT_URL=https://ppplayer.com/"

# ── 4) Fast Testing — local ───────────────────────────────────────────────────
run_test "4) Fast Testing (local mode)" 30 \
  "NODE_ENV=development" "BOT_ROLE=local" "MAX_SESSIONS=1"

# ── 5) Tor Proxy ──────────────────────────────────────────────────────────────
skip_test "5) Local Tor Proxy" "requires Tor daemon on port 9050"

# ── 6) Seeding / Persistent Profile ──────────────────────────────────────────
flush_redis
run_test "6) Seeding (persistent session)" 35 \
  "NODE_ENV=production" "BOT_ROLE=both" "MAX_SESSIONS=1" "PERSISTENT_SESSIONS=true"

# ── 7) Human Behavior High Intensity ─────────────────────────────────────────
flush_redis
run_test "7) Human Behavior (high intensity)" 35 \
  "NODE_ENV=production" "BOT_ROLE=both" "MAX_SESSIONS=1" \
  "HUMAN_BEHAVIOR=true" "BEHAVIOR_INTENSITY=high"

# ── 8) Distributed Worker ─────────────────────────────────────────────────────
flush_redis
# Pre-seed 1 job via producer
PORT=$((PORT + 1))
pkill -f "$DIST" 2>/dev/null; sleep 0.5
(
  cd "$PROJ"
  set -o allexport; [ -f .env ] && source .env; set +o allexport
  export REDIS_URL="$REDIS_URL" HEALTH_PORT="$PORT" HEADLESS=true SESSION_TIME=0.1
  export NODE_ENV=production BOT_ROLE=producer MAX_SESSIONS=1
  "$NODE" "$DIST" > /dev/null 2>&1
) &
wait $! 2>/dev/null
echo "(Pre-seeded 1 job for worker)"
run_test "8) Distributed Worker" 30 \
  "NODE_ENV=production" "BOT_ROLE=worker" "MAX_SESSIONS=1"

# ── 9) Distributed Producer ───────────────────────────────────────────────────
flush_redis
run_test "9) Distributed Producer (3 jobs)" 20 \
  "NODE_ENV=production" "BOT_ROLE=producer" "MAX_SESSIONS=3" "DEFAULT_URL=https://ppplayer.com/"

# ── 10) Organic Search ────────────────────────────────────────────────────────
flush_redis
run_test "10) Organic Search (google → ppplayer.com)" 90 \
  "NODE_ENV=production" "BOT_ROLE=both" "MAX_SESSIONS=1" \
  "ORGANIC_SEARCH=true" "SEARCH_KEYWORDS=ppplayer" "SEARCH_ENGINE=google" \
  "SEARCH_TARGET_TYPE=contains" "SEARCH_TARGET_VALUE=ppplayer" \
  "DEFAULT_URL=https://ppplayer.com/"

# ── 11) Organic Search No Proxy ───────────────────────────────────────────────
flush_redis
run_test "11) Organic Search no proxy" 90 \
  "NODE_ENV=production" "BOT_ROLE=both" "MAX_SESSIONS=1" \
  "ORGANIC_SEARCH=true" "SEARCH_KEYWORDS=ppplayer" "SEARCH_ENGINE=google" \
  "SEARCH_TARGET_TYPE=contains" "SEARCH_TARGET_VALUE=ppplayer" \
  "DEFAULT_URL=https://ppplayer.com/" "PROXY_URL=" "PROXY_PORT="

# ── 12) Targeted Google Search ────────────────────────────────────────────────
flush_redis
run_test "12) Targeted Search (url match)" 90 \
  "NODE_ENV=production" "BOT_ROLE=both" "MAX_SESSIONS=1" \
  "ORGANIC_SEARCH=true" "SEARCH_KEYWORDS=ppplayer" "SEARCH_ENGINE=google" \
  "SEARCH_TARGET_TYPE=url" "SEARCH_TARGET_VALUE=https://ppplayer.com/" \
  "DEFAULT_URL=https://ppplayer.com/"

# ── SUMMARY ───────────────────────────────────────────────────────────────────
echo ""
echo "=================================================="
echo "  AUDIT SUMMARY"
echo "=================================================="
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
echo "  PASS: $PASS  |  FAIL: $FAIL  |  SKIP: $SKIP"
echo "=================================================="
pkill -f "$DIST" 2>/dev/null
[ $FAIL -eq 0 ] && exit 0 || exit 1
