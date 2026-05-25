#!/bin/bash
# Extras: render Replit, Posthog, Supabase to add to the gallery.
set -u
LOG=~/Desktop/Projects/Hackathons/promo-agent/sample-run/gallery/extras.log
OUT_DIR=~/Desktop/Projects/Hackathons/promo-agent/sample-run/gallery
echo "=== extras render start $(date) ===" | tee -a "$LOG"

declare -a BRANDS=(
  "replit|https://replit.com"
  "posthog|https://posthog.com"
  "supabase|https://supabase.com"
)

for entry in "${BRANDS[@]}"; do
  slug="${entry%%|*}"
  url="${entry##*|}"
  echo "[$(date +%H:%M:%S)] >>> $slug ($url)" | tee -a "$LOG"
  result=$(nemoclaw promo-agent exec -- bash -c "rm -f /sandbox/out-${slug}.mp4 /sandbox/spec.json; bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh ${url} /sandbox/out-${slug}.mp4 2>&1 | tail -5; ls -la /sandbox/out-${slug}.mp4 2>/dev/null" 2>&1)
  echo "$result" | tee -a "$LOG"
  if echo "$result" | grep -q "out-${slug}.mp4"; then
    nemoclaw promo-agent exec -- base64 "/sandbox/out-${slug}.mp4" 2>/dev/null | base64 -d > "$OUT_DIR/${slug}.mp4"
    size=$(du -h "$OUT_DIR/${slug}.mp4" 2>/dev/null | cut -f1)
    echo "    pulled: ${slug}.mp4 ($size)" | tee -a "$LOG"
  else
    echo "    FAILED to render $slug" | tee -a "$LOG"
  fi
done

echo "=== extras render done $(date) ===" | tee -a "$LOG"
