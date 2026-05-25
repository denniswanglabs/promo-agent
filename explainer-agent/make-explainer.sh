#!/bin/bash
# make-explainer.sh — give the NemoClaw agent a prompt + URL,
# get back a rendered explainer video.
#
# Usage:
#   ./make-explainer.sh "Find the installation command for the Card component"
#   ./make-explainer.sh "Find Sonner install" "https://ui.shadcn.com"
#   ./make-explainer.sh "Find docs about Server Components" "https://nextjs.org"

set -euo pipefail

GOAL="${1:?usage: $0 \"<goal>\" [start_url] [max_steps]}"
START_URL="${2:-https://ui.shadcn.com}"
MAX_STEPS="${3:-6}"

HERE="$(cd "$(dirname "$0")" && pwd)"
SLUG=$(echo "$GOAL" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | sed 's/--*/-/g; s/^-//; s/-$//' | cut -c1-40)
TIMESTAMP=$(date +%H%M%S)
OUT_MP4="$HERE/out-$TIMESTAMP-$SLUG.mp4"

echo "============================================================"
echo "  Goal:       $GOAL"
echo "  Start URL:  $START_URL"
echo "  Max steps:  $MAX_STEPS"
echo "  Output:     $OUT_MP4"
echo "============================================================"
echo

echo "[1/4] Running agent in NemoClaw sandbox..."
~/.local/bin/nemoclaw promo-agent exec --no-tty --timeout 300 -- bash -c \
  "rm -rf /sandbox/explainer-agent/run && export GOAL=$(printf '%q' "$GOAL") && export START_URL=$(printf '%q' "$START_URL") && export MAX_STEPS=$MAX_STEPS && bash /sandbox/explainer-agent/run.sh" 2>&1 \
  | grep -E '^\[' | tail -30

echo
echo "[2/4] Pulling artifacts..."
cd "$HERE/remotion/public"
rm -rf screenshots-sandbox
mkdir -p screenshots-sandbox
~/.local/bin/nemoclaw promo-agent exec --no-tty -- cat /sandbox/explainer-agent/run/action-log.json > /tmp/sandbox-action-log.json 2>/dev/null

ACTION_COUNT=$(python3 -c 'import json; print(len(json.load(open("/tmp/sandbox-action-log.json"))["actions"]))')
echo "  agent recorded $ACTION_COUNT actions"

if [ "$ACTION_COUNT" -lt 1 ]; then
  echo "  ERROR: no actions recorded. Agent failed to navigate."
  exit 1
fi

files=$(~/.local/bin/nemoclaw promo-agent exec --no-tty -- ls /sandbox/explainer-agent/run/screenshots/ 2>/dev/null | tr -d '\r')
for f in $files; do
  ~/.local/bin/nemoclaw promo-agent exec --no-tty -- base64 "/sandbox/explainer-agent/run/screenshots/$f" 2>/dev/null | base64 -d > "screenshots-sandbox/$f"
done
echo "  pulled $(ls screenshots-sandbox | wc -l | tr -d ' ') screenshots"

python3 /tmp/rewrite-log.py > /dev/null
echo "  action-log rewritten (paths + synthetic done step)"

echo
echo "[3/4] Rendering Remotion composition..."
cd "$HERE/remotion"
./node_modules/.bin/remotion render src/index.ts Explainer "$OUT_MP4" --concurrency=8 --log=error 2>&1 | tail -3

if [ ! -f "$OUT_MP4" ]; then
  echo "  ERROR: render failed."
  exit 1
fi

SIZE=$(ls -la "$OUT_MP4" | awk '{print $5}')
echo "  rendered: $OUT_MP4 ($SIZE bytes)"

echo
echo "[4/4] Opening in QuickTime..."
open "$OUT_MP4"

echo
echo "DONE. Video: $OUT_MP4"
