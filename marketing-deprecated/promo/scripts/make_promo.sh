#!/usr/bin/env bash
# make_promo.sh — URL → animated promo MP4 in one shell command.
# Default mode: kinetic typography (no assets, $0, ~2 min).
#
# Usage:
#   make_promo.sh <URL> [output.mp4]
#   make_promo.sh --mode=asset <URL> [output.mp4]   # (deferred: Higgsfield path)

set -euo pipefail

# Source sandbox env (NVIDIA_API_KEY etc.) if present. Host already has env from .zshrc.
[ -f /sandbox/.config/promo-agent/env.sh ] && source /sandbox/.config/promo-agent/env.sh

MODE="kinetic"
URL=""
OUT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode=*)  MODE="${1#*=}"; shift ;;
    --mode)    MODE="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *)
      if [ -z "$URL" ]; then URL="$1"
      elif [ -z "$OUT" ]; then OUT="$1"
      else echo "Unknown arg: $1" >&2; exit 2
      fi
      shift ;;
  esac
done

if [ -z "$URL" ]; then
  echo "Usage: $0 [--mode=kinetic|asset] <URL> [output.mp4]" >&2
  exit 2
fi

# ---- Path discovery ------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROMO_RESEARCH_FETCH="$(cd "$SKILL_DIR/.." && pwd)/promo-research/scripts/fetch_brand.py"

if [ ! -f "$PROMO_RESEARCH_FETCH" ]; then
  for candidate in \
      /sandbox/.openclaw/skills/promo-research/scripts/fetch_brand.py \
      "$HOME/.openclaw/skills/promo-research/scripts/fetch_brand.py"; do
    if [ -f "$candidate" ]; then PROMO_RESEARCH_FETCH="$candidate"; break; fi
  done
fi

if [ ! -f "$PROMO_RESEARCH_FETCH" ]; then
  echo "ERROR: cannot locate fetch_brand.py" >&2
  exit 1
fi

if [ -d /sandbox ] && [ -w /sandbox ]; then
  PROJECT="/sandbox/promo-render"
  DEFAULT_OUT="/sandbox/out.mp4"
  LD_LIBS="/tmp/chrome-libs/extracted/usr/lib/aarch64-linux-gnu"
else
  PROJECT="$HOME/.cache/promo-agent/promo-render"
  DEFAULT_OUT="$HOME/.cache/promo-agent/out.mp4"
  LD_LIBS=""
fi
OUT="${OUT:-$DEFAULT_OUT}"

mkdir -p "$PROJECT/public" "$(dirname "$OUT")"

# ---- 1. Fetch brand data -------------------------------------------------
echo "==> [1/5] fetch_brand: $URL"
BRAND_DATA_FILE="$(mktemp)"
trap 'rm -f "$BRAND_DATA_FILE"' EXIT
python3 "$PROMO_RESEARCH_FETCH" "$URL" > "$BRAND_DATA_FILE" 2>&1 || {
  echo "ERROR: fetch_brand.py failed" >&2
  cat "$BRAND_DATA_FILE" >&2
  exit 1
}
echo "    brand data: $(wc -c < "$BRAND_DATA_FILE" | xargs) bytes"

# ---- 2. Call Nemotron for the CompositionSpec ----------------------------
echo "==> [2/5] Nemotron → CompositionSpec"
if [ -z "${NVIDIA_API_KEY:-}" ]; then
  echo "ERROR: NVIDIA_API_KEY not set in env" >&2
  exit 1
fi

SYSTEM_PROMPT='detailed thinking off

You produce CompositionSpec JSON for kinetic-typography promo videos. Given fetched brand data, output ONLY a single JSON object — no preamble, no markdown code fences, no reasoning prose:

{
  "template": "kinetic-30s",
  "total_duration_f": 900,
  "palette": {"primary": "#XXXXXX", "accent": "#XXXXXX"},
  "music": {"track": "anthem | corporate | warm | tense"},
  "scenes": [
    {
      "act": 1,
      "duration_f": 120,
      "type": "cold_open | problem | solution_reveal | feature_montage | social_proof | cta",
      "copy": ["line 1 (max 8 words)", "line 2 (max 8 words, optional)"],
      "asset_brief": "kinetic_text",
      "asset_type": "kinetic_text"
    }
  ]
}

Rules:
- Exactly 5 scenes
- scene_1.type is one of {cold_open, problem}; scene_5.type is exactly "cta"
- Include at least one social_proof scene IF the brand data has a named customer quote
- duration_f values sum to exactly 900
- palette.primary = first hex from the PALETTE section; palette.accent = a contrasting hex from the same section
- music.track must be exactly one of: anthem (SaaS cinematic, dev tools), corporate (B2B, enterprise), warm (consumer, mission-driven, design-led), tense (security, compliance, urgency). Pick based on the brand vibe in the fetched data.
- copy lines must ground in the fetched data — no invented stats, no fabricated quotes
- Forbidden words: revolutionary, game-changing, world-class, cutting-edge, next-gen, transformative
- Output ONLY the JSON object, nothing else'

REQUEST_BODY="$(mktemp)"
trap 'rm -f "$BRAND_DATA_FILE" "$REQUEST_BODY"' EXIT
jq -n \
  --arg system "$SYSTEM_PROMPT" \
  --arg user "$(cat "$BRAND_DATA_FILE")" \
  '{
    model: "nvidia/nemotron-3-super-120b-a12b",
    messages: [
      {role: "system", content: $system},
      {role: "user", content: $user}
    ],
    max_tokens: 4096,
    temperature: 0.4
  }' > "$REQUEST_BODY"

RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$BRAND_DATA_FILE" "$REQUEST_BODY" "$RESPONSE_FILE"' EXIT

HTTP_CODE=$(curl -sS -o "$RESPONSE_FILE" -w "%{http_code}" \
  -X POST https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d @"$REQUEST_BODY")

if [ "$HTTP_CODE" != "200" ]; then
  echo "ERROR: Nemotron HTTP $HTTP_CODE" >&2
  head -20 "$RESPONSE_FILE" >&2
  exit 1
fi

SPEC_RAW=$(jq -r '.choices[0].message.content' "$RESPONSE_FILE")
SPEC_JSON=$(echo "$SPEC_RAW" | sed -E '/^```[a-z]*$/d; /^```$/d')

# Fallback: if model leaked reasoning, extract the largest {...} block
if ! echo "$SPEC_JSON" | jq -e '.scenes | length > 0' > /dev/null 2>&1; then
  EXTRACTED=$(echo "$SPEC_RAW" | python3 -c '
import sys, json
text = sys.stdin.read()
best = ""
depth = 0
start = -1
for i, c in enumerate(text):
    if c == "{":
        if depth == 0:
            start = i
        depth += 1
    elif c == "}":
        depth -= 1
        if depth == 0 and start >= 0:
            candidate = text[start:i+1]
            try:
                obj = json.loads(candidate)
                if isinstance(obj, dict) and "scenes" in obj and len(candidate) > len(best):
                    best = candidate
            except Exception:
                pass
            start = -1
print(best)
' 2>/dev/null)
  if [ -n "$EXTRACTED" ]; then
    SPEC_JSON="$EXTRACTED"
    echo "    (extracted JSON from reasoning prose)" >&2
  fi
fi

# ---- 3. Validate + save spec ---------------------------------------------
if [ -d /sandbox ] && [ -w /sandbox ]; then
  SPEC_OUT="/sandbox/spec.json"
else
  SPEC_OUT="$HOME/.cache/promo-agent/spec.json"
  mkdir -p "$(dirname "$SPEC_OUT")"
fi

if ! echo "$SPEC_JSON" | jq -e '.scenes | length > 0' > /dev/null 2>&1; then
  echo "ERROR: Nemotron output not valid JSON or missing scenes" >&2
  echo "Output (first 500 chars):" >&2
  echo "$SPEC_JSON" | head -c 500 >&2
  echo >&2
  exit 1
fi

echo "$SPEC_JSON" > "$SPEC_OUT"
echo "    spec.json: $(wc -c < "$SPEC_OUT" | xargs) bytes, $(jq '.scenes | length' "$SPEC_OUT") scenes"

# ---- 4. Write Remotion project ------------------------------------------
echo "==> [3/5] write Remotion project (mode=$MODE)"
python3 "$SCRIPT_DIR/write_remotion_project.py" "$SPEC_OUT" "$PROJECT" --mode="$MODE"

# ---- 5. Render -----------------------------------------------------------
echo "==> [4/5] npx remotion render → $OUT"
cd "$PROJECT"

if [ ! -d node_modules ]; then
  echo "    installing Remotion deps (first run only, ~30s)..."
  if [ ! -f package.json ]; then
    printf '%s' '{"name":"promo-render","version":"1.0.0","type":"module","dependencies":{"remotion":"latest","@remotion/cli":"latest","@remotion/renderer":"latest","@remotion/bundler":"latest","react":"^18.3.1","react-dom":"^18.3.1"}}' > package.json
  fi
  npm install --silent 2>&1 | tail -3
fi

if [ -n "$LD_LIBS" ] && [ -d "$LD_LIBS" ]; then
  LD_LIBRARY_PATH="$LD_LIBS" npx remotion render src/index.ts Promo "$OUT" --log=warn 2>&1 | tail -10
else
  npx remotion render src/index.ts Promo "$OUT" --log=warn 2>&1 | tail -10
fi

if [ ! -s "$OUT" ]; then
  echo "ERROR: render produced empty output at $OUT" >&2
  exit 1
fi

SIZE=$(du -h "$OUT" | cut -f1)
echo "==> [5/5] DONE: $OUT ($SIZE)"
