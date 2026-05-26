#!/bin/bash
# poll-scouts.sh - mirror per-scout CDP screencast frames from the NemoClaw
# sandbox to the host dashboard. Additive companion to poll.sh; does NOT touch
# the single-agent observe pipeline.
#
# Source layout (written by attachScoutScreencast in sandbox agent.js, v21+):
#   /sandbox/explainer-agent/run/scout-frames/r{round}_s{slot}/f{NNNNN}.jpg
#   /sandbox/explainer-agent/run/scout-frames/r{round}_s{slot}/meta.jsonl
#
# For each slot 0..3 we find the most recent jpg across ALL rounds (so when
# round R+1 starts the dashboard follows it), atomically swap it into:
#   public/scouts/s{slot}/latest.jpg
#
# Run: bash poll-scouts.sh > /tmp/poll-scouts.log 2>&1 &

set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_DIR="$DIR/public/scouts"
mkdir -p "$HOST_DIR"/{s0,s1,s2,s3}
cd "$DIR"

NEMOCLAW="$HOME/.local/bin/nemoclaw"
SBX_BASE="/sandbox/explainer-agent/run/scout-frames"

echo "polling sandbox scout-frames -> $HOST_DIR (Ctrl-C to stop)"
echo "source pattern: $SBX_BASE/r*_s{0..3}/f*.jpg"

while true; do
  # Single sandbox round-trip: ask for newest jpg per slot in one shell.
  # Output format per line: "<slot> <abs-path>" or "<slot> -" if none.
  mapping="$("$NEMOCLAW" promo-agent exec --no-tty --timeout 10 -- bash -c 'for s in 0 1 2 3; do f=$(ls -t /sandbox/explainer-agent/run/scout-frames/r*_s${s}/f*.jpg 2>/dev/null | head -1); if [ -n "$f" ]; then echo "$s $f"; else echo "$s -"; fi; done' 2>/dev/null)"

  if [ -z "$mapping" ]; then
    sleep 0.5
    continue
  fi

  while IFS=' ' read -r slot path; do
    [ -z "$slot" ] && continue
    [ "$path" = "-" ] && continue
    tmp="$HOST_DIR/s$slot/.tmp.jpg"
    "$NEMOCLAW" promo-agent exec --no-tty --timeout 10 -- cat "$path" > "$tmp" 2>/dev/null
    if [ -s "$tmp" ]; then
      mv -f "$tmp" "$HOST_DIR/s$slot/latest.jpg"
    else
      rm -f "$tmp"
    fi
  done <<<"$mapping"

  sleep 0.5
done
