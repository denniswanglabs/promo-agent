#!/usr/bin/env bash
# start_promo.sh — background the render and return in <2 sec.
# Pairs with wait_promo.sh which polls /sandbox/out.mp4.
set -euo pipefail

URL="${1:?URL required}"
OUT="${2:-/sandbox/out.mp4}"
LOG=/sandbox/render.log

rm -f "$OUT" "$LOG"

# Background the actual render. nohup + disown so it survives this shell exiting.
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
nohup bash "$SKILL_DIR/make_promo.sh" "$URL" "$OUT" > "$LOG" 2>&1 &
disown

cat <<EOF
STARTED
url=$URL
expected_out=$OUT
expected_complete_in=90s
log_file=$LOG
next_step=call wait_promo.sh after ~90 seconds
EOF
