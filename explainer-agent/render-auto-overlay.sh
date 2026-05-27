#!/bin/bash
# render-auto-overlay.sh
#
# End-to-end wrapper: action-log + base mp4 + goal -> polished overlay mp4.
# Generates the AutoOverlay config, stages the base video in remotion/public/,
# and runs `npx remotion render AutoOverlay`.
#
# Usage:
#   render-auto-overlay.sh <action-log> <base-video> <goal> <out-mp4>
#
# Example:
#   render-auto-overlay.sh \
#     explainer-agent/v11-action-log.json \
#     ~/Downloads/explainer-submission-v22-60fps.mp4 \
#     "Navigate from the home page to 'Map payment data'" \
#     ~/Downloads/auto-overlay-out.mp4

set -euo pipefail

if [ $# -ne 4 ]; then
  echo "usage: $0 <action-log> <base-video> <goal> <out-mp4>" >&2
  exit 2
fi

ACTION_LOG="$1"
BASE_VIDEO="$2"
GOAL="$3"
OUT="$4"

# Resolve paths to absolute so this script works from any cwd.
ACTION_LOG="$(cd "$(dirname "$ACTION_LOG")" && pwd)/$(basename "$ACTION_LOG")"
BASE_VIDEO="$(cd "$(dirname "$BASE_VIDEO")" && pwd)/$(basename "$BASE_VIDEO")"
OUT_DIR="$(cd "$(dirname "$OUT")" && pwd)"
OUT="$OUT_DIR/$(basename "$OUT")"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTION_DIR="$SCRIPT_DIR/remotion"
PUBLIC_DIR="$REMOTION_DIR/public"
CONFIG_PATH="$PUBLIC_DIR/auto-overlay-config.json"
BASE_DEST="$PUBLIC_DIR/auto-base.mp4"

echo "[auto-overlay] action-log: $ACTION_LOG"
echo "[auto-overlay] base-video: $BASE_VIDEO"
echo "[auto-overlay] goal:       $GOAL"
echo "[auto-overlay] out:        $OUT"

# 1. Build config
node "$SCRIPT_DIR/auto-overlay-config.js" \
  --action-log "$ACTION_LOG" \
  --base-video "$BASE_VIDEO" \
  --goal "$GOAL" \
  --base-path "/auto-base.mp4" \
  --out "$CONFIG_PATH"

# 2. Stage base video in remotion/public so staticFile() can serve it.
# Copy (not symlink) — Remotion's bundler walks the dir.
cp "$BASE_VIDEO" "$BASE_DEST"

# 3. Render
cd "$REMOTION_DIR"
npx remotion render AutoOverlay "$OUT" \
  --concurrency=8 \
  --width=2560 \
  --height=1440 \
  --frame-rate=60

echo "[auto-overlay] done → $OUT"
