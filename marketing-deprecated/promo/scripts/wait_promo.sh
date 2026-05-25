#!/usr/bin/env bash
# wait_promo.sh — poll /sandbox/out.mp4 up to MAX_SEC seconds, exit when found OR timeout.
# Stays well under the tool_search_code JS sandbox timeout (default 30s).
set -euo pipefail

MAX_SEC="${1:-25}"
OUT="${2:-/sandbox/out.mp4}"
LOG=/sandbox/render.log

start=$(date +%s)
while [ $(($(date +%s) - start)) -lt "$MAX_SEC" ]; do
  if [ -f "$OUT" ] && [ "$(stat -c%s "$OUT" 2>/dev/null || echo 0)" -gt 100000 ]; then
    size=$(du -h "$OUT" | cut -f1)
    echo "DONE"
    echo "path=$OUT"
    echo "size=$size"
    exit 0
  fi
  sleep 2
done

echo "PENDING after ${MAX_SEC}s — render still in progress"
echo "log_tail:"
tail -5 "$LOG" 2>/dev/null || echo "(no log yet)"
