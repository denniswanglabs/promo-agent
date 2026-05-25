#!/usr/bin/env bash
# render_promo_async.sh — kick off render_promo.sh in the background.
# Returns immediately with the log + status file paths so the agent can
# poll progress via fast `tail` calls instead of blocking for 10 min.
#
# Usage: render_promo_async.sh <spec.json> <output.mp4>

set -euo pipefail

SPEC="${1:-/sandbox/spec.json}"
OUT="${2:-/sandbox/out.mp4}"
LOG="/sandbox/render.log"
STATUS="/sandbox/render.status"
PIDFILE="/sandbox/render.pid"

# Kill any previous background render that might be lingering
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "WARN: previous render (PID $(cat "$PIDFILE")) still running. Killing it." >&2
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 1
fi

# Reset state
: > "$LOG"
echo "starting" > "$STATUS"
rm -f "$OUT"

# Fork the real script detached
SCRIPT_DIR="$(dirname "$0")"
nohup bash -c "
  bash '$SCRIPT_DIR/render_promo.sh' '$SPEC' '$OUT' > '$LOG' 2>&1
  EC=\$?
  if [ \$EC -eq 0 ] && [ -s '$OUT' ]; then
    echo done > '$STATUS'
  else
    echo \"failed exit=\$EC\" > '$STATUS'
  fi
  rm -f '$PIDFILE'
" >/dev/null 2>&1 &
echo $! > "$PIDFILE"

echo "Background render started."
echo "  PID:    $(cat "$PIDFILE")"
echo "  Log:    $LOG"
echo "  Status: $STATUS"
echo
echo "Poll with:  tail -20 $LOG"
echo "    OR:     cat $STATUS"
echo
echo "Status values: starting | running | done | failed"
