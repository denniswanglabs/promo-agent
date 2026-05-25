#!/usr/bin/env bash
# render_promo.sh — turn a CompositionSpec JSON into an MP4.
# Usage: render_promo.sh <spec.json> <output.mp4>

set -euo pipefail

SPEC="${1:-/sandbox/spec.json}"
OUT="${2:-/sandbox/out.mp4}"
PROJECT="/sandbox/promo-render"
PUBLIC="$PROJECT/public"
HIGGS="/sandbox/.local/bin/higgsfield"

[ -f "$SPEC" ] || { echo "spec not found: $SPEC" >&2; exit 1; }
[ -d "$PROJECT" ] || { echo "remotion project not found at $PROJECT" >&2; exit 1; }

mkdir -p "$PUBLIC" "$PROJECT/src"

scene_count="$(jq '.scenes | length' "$SPEC")"
echo "==> spec has $scene_count scenes"

# Generate each scene's asset
for i in $(seq 0 $((scene_count - 1))); do
  idx=$((i + 1))
  asset_type=$(jq -r ".scenes[$i].asset_type" "$SPEC")
  asset_brief=$(jq -r ".scenes[$i].asset_brief" "$SPEC")
  ext="png"; [ "$asset_type" = "video" ] && ext="mp4"
  out_path="$PUBLIC/scene_${idx}.${ext}"

  if [ -s "$out_path" ]; then
    echo "==> scene_$idx asset cached at $out_path"
    continue
  fi

  echo "==> scene_$idx: generating $asset_type via Higgsfield..."
  if [ "$asset_type" = "video" ]; then
    model="seedance_2_0"
    extra_flags="--duration 5"
  else
    model="gpt_image_2"
    extra_flags=""
  fi

  # shellcheck disable=SC2086
  result=$("$HIGGS" generate create "$model" --prompt "$asset_brief" --aspect_ratio 16:9 $extra_flags --wait --json 2>&1) || {
    echo "ERROR: Higgsfield generate failed for scene_$idx" >&2
    echo "$result" | tail -10 >&2
    exit 1
  }

  # Always echo a short slice of the response so we can see what Higgsfield returned
  # (defends against silent-failure mode where stdout never surfaces).
  echo "    higgsfield response (first 3 lines):"
  echo "$result" | head -3 | sed 's/^/        /'

  # Extract the result URL from the JSON. Higgsfield returns the URL in `.result_url`
  # (not `.url`). Be defensive and check both. CLI returns an array of jobs; first one
  # is the latest. Recurse to find the field at any depth.
  url=$(echo "$result" | jq -r 'if type=="array" then .[0] else . end | .. | (.result_url? // .url?) // empty | select(. != null)' | grep -E '^https?://' | head -1)
  if [ -z "$url" ]; then
    echo "ERROR: no URL parsed from Higgsfield output for scene_$idx" >&2
    echo "    response was:" >&2
    echo "$result" | head -30 >&2
    exit 1
  fi

  echo "    download: $url -> $out_path"
  curl -fsSL -o "$out_path" "$url" || { echo "ERROR: download failed for scene_$idx ($url)" >&2; exit 1; }
  echo "    saved: $(wc -c < "$out_path" | xargs) bytes"
done

echo "==> all $scene_count assets ready"

# Write the Remotion composition from the spec
python3 "$(dirname "$0")/write_remotion_project.py" "$SPEC" "$PROJECT"

# Render. Chrome headless shell needs NSPR + NSS libs which the sandbox doesn't
# ship by default; we extracted them to /tmp/chrome-libs/extracted/ via .deb
# direct-download. LD_LIBRARY_PATH points the dynamic linker at them.
echo "==> rendering..."
cd "$PROJECT"
LD_LIBRARY_PATH=/tmp/chrome-libs/extracted/usr/lib/aarch64-linux-gnu:${LD_LIBRARY_PATH:-} \
  npx remotion render src/index.ts Promo "$OUT" --log=warn 2>&1 | tail -10

if [ ! -s "$OUT" ]; then
  echo "ERROR: render produced empty or missing output: $OUT" >&2
  exit 1
fi

echo "==> DONE: $OUT ($(du -h "$OUT" | cut -f1))"
