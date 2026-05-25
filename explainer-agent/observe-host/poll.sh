#!/bin/bash
# poll.sh — copy /sandbox/explainer-agent/observe/{latest.jpg,log.txt} from
# the NemoClaw sandbox to ./public/ every 500 ms. The static viewer reads
# from ./public/ and refreshes on a similar cadence.

set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/public"
cd "$DIR"

# Seed dummy files so the viewer doesn't 404 before the agent starts
[ -f public/frame.jpg ] || cp -f /System/Library/CoreServices/DefaultDesktop.heic public/frame.jpg 2>/dev/null || touch public/frame.jpg
touch public/log.txt

echo "polling sandbox observe dir → $DIR/public/  (Ctrl-C to stop)"

while true; do
  ~/.local/bin/nemoclaw promo-agent exec --no-tty -- cat /sandbox/explainer-agent/observe/latest.jpg > public/frame.jpg.next 2>/dev/null
  if [ -s public/frame.jpg.next ]; then
    mv -f public/frame.jpg.next public/frame.jpg
  fi
  ~/.local/bin/nemoclaw promo-agent exec --no-tty -- cat /sandbox/explainer-agent/observe/log.txt > public/log.txt.next 2>/dev/null
  if [ -s public/log.txt.next ]; then
    mv -f public/log.txt.next public/log.txt
  fi
  sleep 0.5
done
