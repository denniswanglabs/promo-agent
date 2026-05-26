#!/bin/bash
# gen-manifest.sh - emit a manifest of currently-active scouts for the adaptive
# grid dashboard. Reads mtimes of public/scouts/s*/latest.jpg and lists only
# the ones updated within the last ACTIVE_WINDOW seconds. Runs forever every
# POLL_INTERVAL seconds.
#
# Run: bash gen-manifest.sh > /tmp/gen-manifest.log 2>&1 &
#
# Safe to run alongside poll-scouts.sh; only writes to public/scouts/manifest.json.

set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SCOUTS_DIR="$DIR/public/scouts"
OUT="$SCOUTS_DIR/manifest.json"
TMP="$SCOUTS_DIR/.manifest.json.tmp"
LOG_SRC="$DIR/public/log.txt"
EVENTS_OUT="$SCOUTS_DIR/events.jsonl"
EVENTS_TMP="$SCOUTS_DIR/.events.jsonl.tmp"
ACTIVE_WINDOW="${ACTIVE_WINDOW:-30}"
POLL_INTERVAL="${POLL_INTERVAL:-0.2}"
EVENTS_MAX="${EVENTS_MAX:-200}"

mkdir -p "$SCOUTS_DIR"

# Human-readable labels per slot (matches the legacy fixed dashboard).
label_for() {
  case "$1" in
    s0) echo "CMD+K SEARCH SCOUT" ;;
    s1) echo "CANDIDATE 1" ;;
    s2) echo "CANDIDATE 2" ;;
    s3) echo "CANDIDATE 3" ;;
    *)  echo "SCOUT" ;;
  esac
}

while true; do
  now="$(date +%s.%N)"
  entries=""
  first=1
  # Iterate any sN directory that exists; scales beyond s0..s3.
  for d in "$SCOUTS_DIR"/s*; do
    [ -d "$d" ] || continue
    slot="$(basename "$d")"
    f="$d/latest.jpg"
    [ -f "$f" ] || continue

    # mtime as float seconds since epoch (BSD stat on macOS).
    mtime="$(stat -f %m "$f" 2>/dev/null)"
    [ -z "$mtime" ] && continue

    age="$(awk -v n="$now" -v m="$mtime" 'BEGIN { printf "%.3f", n - m }')"
    fresh="$(awk -v a="$age" -v w="$ACTIVE_WINDOW" 'BEGIN { print (a+0 <= w+0) ? 1 : 0 }')"
    [ "$fresh" = "1" ] || continue

    label="$(label_for "$slot")"
    num="$(echo "$slot" | tr -d 's' | tr '[:lower:]' '[:upper:]')"
    full_label="S${num} ${label}"

    if [ "$first" = "1" ]; then first=0; else entries="$entries,"; fi
    entries="$entries$(printf '{"slot":"%s","label":"%s","lastUpdateSec":%s}' "$slot" "$full_label" "$age")"
  done

  printf '{"updatedAt":%s,"scouts":[%s]}\n' "$now" "$entries" > "$TMP"
  mv -f "$TMP" "$OUT"

  # --- events.jsonl: parse mirrored log.txt into per-scout step events ---
  # Recognized lines (from agent.sandbox-v26.js, written via observe/log.txt):
  #   [HH:MM:SS] beam-round N slot S [tag] URL ot=true at=false | reasoning
  #   [HH:MM:SS] beam-round N: WINNER slot S [tag] -> URL
  #   [HH:MM:SS] beam-round N (kept K): URL (...)
  # Each becomes one JSON event. Tail the last EVENTS_MAX matching lines so
  # the file stays bounded. If log.txt is missing/empty, emit an empty file.
  if [ -f "$LOG_SRC" ]; then
    perl -ne '
      sub jesc { my $s = shift; $s =~ s/\\/\\\\/g; $s =~ s/"/\\"/g; $s =~ s/\t/ /g; $s =~ s/\r//g; return $s; }
      sub trunc { my ($s, $n) = @_; return (length($s) > $n) ? substr($s, 0, $n - 3) . "..." : $s; }
      if (/^\[([0-9:]+)\] beam-round (\d+) slot (\d+) \[([^\]]+)\] (.+?) ot=(true|false) at=(true|false) \| ?(.*)$/) {
        my ($ts, $round, $slot, $tag, $url, $ot, $at, $reason) = ($1, $2, $3, $4, $5, $6, $7, $8);
        my $verdict = ($at eq "true") ? "at-destination" : (($ot eq "true") ? "on-track" : "off-track");
        my $action = trunc("[$tag] $url", 80);
        $reason = trunc($reason, 140);
        printf qq({"ts":"%s","scout":"s%s","round":%s,"action":"%s","verdict":"%s","reasoning":"%s","kind":"step"}\n), $ts, $slot, $round, jesc($action), $verdict, jesc($reason);
      } elsif (/^\[([0-9:]+)\] beam-round (\d+): WINNER slot (\d+) \[([^\]]+)\] -> (.+)$/) {
        my ($ts, $round, $slot, $tag, $url) = ($1, $2, $3, $4, $5);
        my $action = trunc("WINNER [$tag] $url", 80);
        printf qq({"ts":"%s","scout":"s%s","round":%s,"action":"%s","verdict":"winner","reasoning":"","kind":"winner"}\n), $ts, $slot, $round, jesc($action);
      } elsif (/^\[([0-9:]+)\] beam-round (\d+) \(kept (\d+)\): (.+)$/) {
        my ($ts, $round, $kept, $url) = ($1, $2, $3, $4);
        my $action = trunc("round $round start  (kept $kept)", 80);
        printf qq({"ts":"%s","scout":"-","round":%s,"action":"%s","verdict":"info","reasoning":"%s","kind":"round"}\n), $ts, $round, jesc($action), jesc($url);
      }
    ' "$LOG_SRC" 2>/dev/null | tail -n "$EVENTS_MAX" > "$EVENTS_TMP"
    if [ -f "$EVENTS_TMP" ]; then
      mv -f "$EVENTS_TMP" "$EVENTS_OUT"
    fi
  else
    : > "$EVENTS_OUT"
  fi

  sleep "$POLL_INTERVAL"
done
