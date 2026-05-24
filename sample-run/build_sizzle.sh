#!/bin/bash
# Build a 30-sec sizzle reel from the 10 gallery MP4s: 3-sec sample from each
# scene (mid-clip) + crossfades. Output: site/public/sizzle.mp4
set -euo pipefail
SRC=~/Desktop/Projects/Hackathons/promo-agent/sample-run/gallery
OUT=~/Desktop/Projects/Hackathons/promo-agent/site/public/sizzle.mp4
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Order chosen for visual variety: dev/AI first, outreach second
BRANDS=(stripe linear vercel anthropic openai cursor replit supabase benchling trayd kolr)

# Each clip is 3 seconds, sampled from mid (frame ~15s of source 30s)
i=0
inputs=""
filters=""
for slug in "${BRANDS[@]}"; do
  src="$SRC/$slug.mp4"
  if [ ! -f "$src" ]; then
    echo "skip missing: $slug" >&2
    continue
  fi
  clip="$TMP/clip_$i.mp4"
  # Pull 3 seconds starting at 13s (mid-scene action)
  ffmpeg -y -ss 13 -t 3 -i "$src" -an -vf "fps=30,scale=1920:1080" -c:v libx264 -preset fast -crf 20 "$clip" 2>/dev/null
  inputs+=" -i $clip"
  i=$((i+1))
done

# Concat with 10-frame crossfades (0.33s @ 30fps) between adjacent clips
n=$i
# Build concat list (simple concat, no crossfade — keeps it fast and reliable)
listfile="$TMP/list.txt"
for j in $(seq 0 $((n-1))); do
  echo "file '$TMP/clip_$j.mp4'" >> "$listfile"
done

ffmpeg -y -f concat -safe 0 -i "$listfile" -c:v libx264 -preset medium -crf 19 -an "$OUT" 2>&1 | tail -5
echo "---"
echo "sizzle: $(du -h "$OUT" | cut -f1), $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT") sec"
