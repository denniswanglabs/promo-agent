#!/usr/bin/env bash
# capture_run.sh — snapshot the sandbox's recent activity and outputs into runs/<timestamp>/.
# Uses `nemoclaw exec -- base64 <file>` for binary file pulls (no SSHFS dep).
#
# Usage:
#   capture_run.sh                  # captures last 30 min of activity
#   capture_run.sh --since 90m      # captures last 90 min
#   capture_run.sh --label first    # adds a label to the run dir name
#
# What it captures (per run):
#   runs/<timestamp>[-label]/
#     transcript.txt          # sandbox logs over the window
#     spec.json               # snapshot of /sandbox/spec.json
#     out.mp4                 # snapshot of /sandbox/out.mp4 if present
#     frames/                 # 6 stills extracted from out.mp4
#     manifest.json           # metadata

set -euo pipefail

WATCHDOG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNS="$WATCHDOG_DIR/runs"
SINCE="30m"
LABEL=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    --label) LABEL="-$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

TS=$(date +%Y%m%d-%H%M%S)
RUN_DIR="$RUNS/${TS}${LABEL}"
mkdir -p "$RUN_DIR/frames"

echo "==> Capturing into $RUN_DIR"

# Helper — pull a file from sandbox via base64; returns 0 if file existed.
pull_file() {
  local sandbox_path="$1"
  local local_path="$2"
  if nemoclaw promo-agent exec -- test -f "$sandbox_path" 2>/dev/null; then
    nemoclaw promo-agent exec -- base64 "$sandbox_path" 2>/dev/null | base64 -d > "$local_path"
    return 0
  fi
  return 1
}

# 1. Transcript (last $SINCE of sandbox activity)
echo "    transcript (last $SINCE)..."
nemoclaw promo-agent logs --since "$SINCE" > "$RUN_DIR/transcript.txt" 2>&1 || true
TRANSCRIPT_LINES=$(wc -l < "$RUN_DIR/transcript.txt" | xargs)
echo "        $TRANSCRIPT_LINES log lines"

# 2. spec.json
if pull_file /sandbox/spec.json "$RUN_DIR/spec.json"; then
  echo "    spec.json: $(wc -c < "$RUN_DIR/spec.json" | xargs) bytes"
else
  echo "    spec.json: NOT FOUND"
fi

# 3. out.mp4
MP4_BYTES=0
if pull_file /sandbox/out.mp4 "$RUN_DIR/out.mp4"; then
  MP4_BYTES=$(wc -c < "$RUN_DIR/out.mp4" | xargs)
  echo "    out.mp4: $MP4_BYTES bytes"

  # 4. Frame extraction (6 evenly spaced stills via host ffmpeg)
  if command -v ffmpeg >/dev/null 2>&1; then
    DURATION=$(ffmpeg -i "$RUN_DIR/out.mp4" 2>&1 | grep -oE 'Duration: [0-9:.]+' | head -1 | cut -d' ' -f2 | awk -F: '{print $1*3600 + $2*60 + $3}')
    if [ -n "${DURATION:-}" ]; then
      for i in 1 2 3 4 5 6; do
        t=$(awk -v d="$DURATION" -v i="$i" 'BEGIN { printf "%.2f", d * i / 7 }')
        ffmpeg -y -ss "$t" -i "$RUN_DIR/out.mp4" -frames:v 1 -q:v 2 "$RUN_DIR/frames/frame_${i}.png" -loglevel error 2>&1 || true
      done
      echo "    frames: $(ls "$RUN_DIR/frames" 2>/dev/null | wc -l | xargs) extracted (duration ${DURATION}s)"
    else
      echo "    frames: SKIPPED (couldn't parse duration)"
    fi
  else
    echo "    frames: SKIPPED (ffmpeg not on host)"
  fi
else
  echo "    out.mp4: NOT FOUND"
fi

# 5. Asset listing
nemoclaw promo-agent exec -- bash -c 'ls -la /sandbox/promo-render/public/ 2>/dev/null' > "$RUN_DIR/assets-listing.txt" 2>&1 || true

# 6. Higgsfield balance snapshot (for spend tracking across runs)
CREDITS=$(nemoclaw promo-agent exec -- /sandbox/.local/bin/higgsfield account status 2>/dev/null | grep -oE '[0-9]+\.[0-9]+ credits' | head -1)
[ -z "${CREDITS:-}" ] && CREDITS="unknown"
echo "    higgsfield: $CREDITS"

# 7. Manifest
cat > "$RUN_DIR/manifest.json" <<EOF
{
  "timestamp": "$TS",
  "since": "$SINCE",
  "label": "${LABEL#-}",
  "mp4_bytes": $MP4_BYTES,
  "transcript_lines": $TRANSCRIPT_LINES,
  "higgsfield_credits_at_capture": "$CREDITS",
  "captured_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "review_status": "pending"
}
EOF

echo "==> Done: $RUN_DIR"
