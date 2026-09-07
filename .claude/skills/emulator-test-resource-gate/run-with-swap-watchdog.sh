#!/bin/bash
# Runs `npm run test:emulator` (or a filtered subset via $1) while watching
# swap usage; aborts the run the moment swap pressure crosses a threshold,
# since that's been the strongest signal correlated with unreliable/hung
# emulator tests on constrained hardware — see SKILL.md in this same
# directory for the evidence and the "known machines" policy this supports.
#
# Usage:
#   run-with-swap-watchdog.sh                 # full suite
#   run-with-swap-watchdog.sh "path/to/one.emulator.spec.ts"   # one file
#
# Exit codes: the underlying test run's own exit code if it completes,
# or 2 if this watchdog aborted it for swap pressure (check the log for
# which — a 2 means "inconclusive due to resources", not "tests failed").

set -uo pipefail

SWAP_THRESHOLD_PCT=50   # abort once swap usage reaches this percentage
CHECK_INTERVAL=10        # seconds between checks
LOG="${TMPDIR:-/tmp}/emulator-test-watchdog-$(date +%s).log"

INCLUDE="${1:-}"
if [ -n "$INCLUDE" ]; then
  CMD=(npx ng run meeting-agenda-generator:test-emulator --include="$INCLUDE")
else
  CMD=(npm run test:emulator)
fi

echo "Running: ${CMD[*]}"
echo "Log: $LOG"
echo "Swap abort threshold: ${SWAP_THRESHOLD_PCT}%"

"${CMD[@]}" > "$LOG" 2>&1 &
TEST_PID=$!

ABORTED=0
while kill -0 "$TEST_PID" 2>/dev/null; do
  SWAP_TOTAL=$(free -m | awk '/Swap:/ {print $2}')
  SWAP_USED=$(free -m | awk '/Swap:/ {print $3}')
  if [ "${SWAP_TOTAL:-0}" -gt 0 ]; then
    SWAP_PCT=$(( SWAP_USED * 100 / SWAP_TOTAL ))
    if [ "$SWAP_PCT" -ge "$SWAP_THRESHOLD_PCT" ]; then
      echo "ABORTING: swap usage ${SWAP_PCT}% reached the ${SWAP_THRESHOLD_PCT}% threshold — killing the test run." | tee -a "$LOG"
      pkill -P "$TEST_PID" 2>/dev/null
      kill "$TEST_PID" 2>/dev/null
      ABORTED=1
      break
    fi
  fi
  sleep "$CHECK_INTERVAL"
done

if [ "$ABORTED" -eq 1 ]; then
  echo "Test run aborted due to swap pressure — this is NOT a test result, it's inconclusive. See $LOG."
  exit 2
fi

wait "$TEST_PID"
CODE=$?
echo "Test run finished with exit code $CODE — see $LOG for full output."
exit $CODE
