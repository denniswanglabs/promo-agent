#!/bin/bash
# Batch-render the 10-brand gallery serially inside the NemoClaw sandbox.
# Pulls each MP4 to host samples/ + logs results.

set -u
LOG=~/Desktop/Projects/Hackathons/promo-agent/sample-run/gallery/render.log
OUT_DIR=~/Desktop/Projects/Hackathons/promo-agent/sample-run/gallery
mkdir -p "$OUT_DIR"
echo "=== gallery render start $(date) ===" | tee -a "$LOG"

# slug → URL (Stripe already done before this script runs)
declare -a BRANDS=(
  "linear|https://linear.app"
  "vercel|https://vercel.com"
  "anthropic|https://anthropic.com"
  "openai|https://openai.com"
  "cursor|https://cursor.com"
  "benchling|https://benchling.com"
  "trayd|https://buildtrayd.com"
  "jgb|https://jgbproperty.com"
  "kolr|https://kolr.ai"
)

for entry in "${BRANDS[@]}"; do
  slug="${entry%%|*}"
  url="${entry##*|}"
  echo "[$(date +%H:%M:%S)] >>> $slug ($url)" | tee -a "$LOG"

  # Inline command (single line — nemoclaw exec rejects newlines)
  result=$(nemoclaw promo-agent exec -- bash -c "rm -f /sandbox/out-${slug}.mp4 /sandbox/spec.json; bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh ${url} /sandbox/out-${slug}.mp4 2>&1 | tail -5; ls -la /sandbox/out-${slug}.mp4 2>/dev/null" 2>&1)
  echo "$result" | tee -a "$LOG"

  # Pull MP4 to host
  if echo "$result" | grep -q "out-${slug}.mp4"; then
    nemoclaw promo-agent exec -- base64 "/sandbox/out-${slug}.mp4" 2>/dev/null | base64 -d > "$OUT_DIR/${slug}.mp4"
    size=$(du -h "$OUT_DIR/${slug}.mp4" 2>/dev/null | cut -f1)
    echo "    pulled: ${slug}.mp4 ($size)" | tee -a "$LOG"
  else
    echo "    FAILED to render $slug — see log above" | tee -a "$LOG"
  fi
done

echo "=== gallery render done $(date) ===" | tee -a "$LOG"
ls -la "$OUT_DIR/"*.mp4 2>&1 | tee -a "$LOG"
