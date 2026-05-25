#!/bin/bash
# render_kinetic.sh — render a sub-agent-produced spec.json to MP4 via Remotion (no Higgsfield).
#
# Translates the sub-agent's spec shape into what KineticPromo.tsx.template expects,
# writes the Remotion project, runs npx remotion render.
#
# Usage: render_kinetic.sh <sub-agent-spec.json> <output.mp4>

set -e
SPEC_IN="${1:?Usage: render_kinetic.sh <spec.json> <out.mp4>}"
OUT="${2:?Usage: render_kinetic.sh <spec.json> <out.mp4>}"

if [ ! -s "$SPEC_IN" ]; then
  echo "ERROR: spec file empty or missing: $SPEC_IN" >&2
  exit 1
fi

WORK="$(mktemp -d -t render-kinetic-XXXXXX)"
SPEC_OUT="$WORK/spec.json"
PROJECT="$WORK/remotion-project"
SCRIPT_DIR="/sandbox/.openclaw/skills/promo/scripts"
TEMPLATE_DIR="$SCRIPT_DIR/templates"

echo "==> [1/4] translate sub-agent spec → kinetic template spec"
python3 <<PYEOF
import json, sys
sa = json.load(open("$SPEC_IN"))
# sub-agent shape: {style, duration_seconds, primary_color, scenes: [{act,type,copy(str),asset_brief}]}
duration_s = sa.get("duration_seconds", 30)
total_f = duration_s * 30
n = max(1, len(sa["scenes"]))
per = total_f // n
primary = sa.get("primary_color", "#0a1f44")
# Derive accent (lighter shade for dark primary, darker for light)
def lum(h):
    h = h.replace("#","")
    r,g,b = int(h[:2],16)/255, int(h[2:4],16)/255, int(h[4:],16)/255
    return 0.2126*r + 0.7152*g + 0.0722*b
accent = "#ffffff" if lum(primary) < 0.45 else "#1a1a1a"

# Translate scenes: copy str → [str], add duration_f, keep act+type
new_scenes = []
for i, s in enumerate(sa["scenes"]):
    raw = s.get("copy", "")
    # feature_montage scenes: split on commas/conjunctions into list
    if s.get("type") == "feature_montage":
        parts = [p.strip() for p in raw.replace(" and ", ", ").split(",") if p.strip()]
        copy = parts if len(parts) >= 2 else [raw]
    else:
        copy = [raw]
    new_scenes.append({
        "act": s.get("act", i+1),
        "type": s.get("type", "cold_open"),
        "copy": copy,
        "duration_f": per
    })
# Ensure scenes sum to total_f
if new_scenes:
    new_scenes[-1]["duration_f"] += (total_f - per*n)

kinetic_spec = {
    "palette": {"primary": primary, "accent": accent},
    "total_duration_f": total_f,
    "scenes": new_scenes
}
json.dump(kinetic_spec, open("$SPEC_OUT","w"), indent=2)
print(f"    Translated: {n} scenes, {total_f}f total, primary={primary}, accent={accent}")
PYEOF

echo "==> [2/4] write Remotion project"
python3 "$SCRIPT_DIR/write_remotion_project.py" "$SPEC_OUT" "$PROJECT" --mode=kinetic

echo "==> [3/4] npm install (if needed)"
cd "$PROJECT"
if [ ! -d node_modules ]; then
  if [ ! -f package.json ]; then
    printf '%s' '{"name":"promo-render","version":"1.0.0","type":"module","dependencies":{"remotion":"latest","@remotion/cli":"latest","@remotion/renderer":"latest","@remotion/bundler":"latest","react":"^18.3.1","react-dom":"^18.3.1"}}' > package.json
  fi
  npm install --silent 2>&1 | tail -2
fi

echo "==> [4/4] npx remotion render → $OUT"
LD_LIBS="${LD_LIBS:-/tmp/chrome-libs/extracted/usr/lib/aarch64-linux-gnu}"
if [ -d "$LD_LIBS" ]; then
  LD_LIBRARY_PATH="$LD_LIBS" npx remotion render src/index.ts Promo "$OUT" --log=warn 2>&1 | tail -15
else
  npx remotion render src/index.ts Promo "$OUT" --log=warn 2>&1 | tail -15
fi

if [ ! -s "$OUT" ]; then
  echo "ERROR: render produced empty output" >&2
  exit 1
fi

SIZE=$(du -h "$OUT" | cut -f1)
echo "==> DONE: $OUT ($SIZE)"
