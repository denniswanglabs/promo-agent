#!/bin/bash
# run.sh — sub-agent dispatch demo, NO Higgsfield, NO render.
#
# Validates the sub-agent architecture end-to-end at the DESIGN level:
#   brand-classifier  -> style decision
#   style-author      -> if classifier returns no match, designs a new style
#   spec-composer     -> produces scene-plan JSON for the chosen style
#   render-watcher    -> narrates the deferred render
#
# Each sub-agent is invoked via `openclaw agent --agent <id>` — same runtime
# the dashboard's sessions_spawn would use, reached via CLI instead.
#
# Run from agent via: openclaw:core:exec command="bash $0 <URL>"
# Or directly: bash $0 <URL>

set -e
URL="${1:?Usage: run.sh <URL>}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RUN_DIR="/sandbox/sub-agent-runs/${TIMESTAMP}"
mkdir -p "$RUN_DIR"
exec > >(tee -a "$RUN_DIR/run.log") 2>&1

echo "=== sub-agent design pipeline at $(date -u) ==="
echo "URL: $URL"
echo "Run dir: $RUN_DIR"
echo ""

spawn_subagent() {
  local agent_id="$1"
  local prompt="$2"
  local label="$3"
  local timeout="${4:-180}"

  echo ">>> sessions_spawn (via CLI): $agent_id  (label=$label, timeout=${timeout}s)"
  local start=$(date +%s)
  local resp_file="$RUN_DIR/${label}.json"

  if ! openclaw agent --agent "$agent_id" -m "$prompt" --json --timeout "$timeout" > "$resp_file" 2>"$RUN_DIR/${label}.err"; then
    echo "!!! $agent_id FAILED (exit $?)"
    cat "$RUN_DIR/${label}.err" >&2 || true
    return 1
  fi

  local elapsed=$(($(date +%s) - start))
  local visible
  visible=$(python3 -c "
import json, sys
text = open('$resp_file').read()
depth = 0; start = -1
for i, c in enumerate(text):
    if c == '{':
        if depth == 0: start = i
        depth += 1
    elif c == '}':
        depth -= 1
        if depth == 0 and start >= 0:
            try:
                obj = json.loads(text[start:i+1])
                def find(d):
                    if isinstance(d, dict):
                        if 'finalAssistantVisibleText' in d:
                            return d['finalAssistantVisibleText']
                        for v in d.values():
                            r = find(v)
                            if r is not None: return r
                    return None
                v = find(obj)
                if v is not None:
                    print(v); sys.exit(0)
            except json.JSONDecodeError:
                pass
            start = -1
print('')
")
  echo "<<< $agent_id replied in ${elapsed}s:"
  echo "----------"
  echo "$visible" | head -30
  echo "----------"
  echo ""
  echo "$visible" > "$RUN_DIR/${label}.visible.txt"
  return 0
}

# ============================================================
# Step 1 — fetch brand
# ============================================================
echo "=== STEP 1: fetch_brand.py ==="
BRAND_FILE="$RUN_DIR/brand.txt"
python3 /sandbox/.openclaw/skills/promo-research/scripts/fetch_brand.py "$URL" > "$BRAND_FILE" 2>&1 || {
  echo "fetch_brand.py FAILED for $URL"; cat "$BRAND_FILE"; exit 1
}
echo "Brand summary captured ($(wc -c < "$BRAND_FILE") bytes)"
head -14 "$BRAND_FILE"
echo "..."
echo ""

BRAND_SHORT=$(head -c 2000 "$BRAND_FILE")

# ============================================================
# Step 2 — brand-classifier
# ============================================================
echo "=== STEP 2: brand-classifier ==="
CLASSIFY_PROMPT="You are the brand-classifier sub-agent. Classify this brand against the existing style library:
- apple-style-30s: B2B SaaS, navy+white palette, ample whitespace, UI screenshots, fade+ease motion. Examples: Stripe, Linear, Vercel.
- kinetic-light-59s: consumer/creator brands, warm accent (orange/coral/yellow), bold display type, real product imagery, spring physics. Examples: Anthropic, Cursor, Replit.
- zelios-53s: luxury/cinematic, dark background, slow camera, high contrast, narrative cold-open. Examples: high-end fashion, premium tech launches.

Score the brand against each style (0.0-1.0). Pick the highest. If the highest is below 0.6, return matched_style: null and provide a seed for authoring a new style.

Brand summary:
$BRAND_SHORT

Reply with ONLY a JSON object (no markdown, no preamble, no thinking):
{\"matched_style\": \"<name or null>\", \"confidence\": <0.0-1.0>, \"reasoning\": \"<one short sentence>\", \"suggested_new_style_seed\": {\"tentative_name\": \"<kebab>\", \"palette_hint\": \"<3 hex colors>\", \"voice_hint\": \"<3 keywords>\", \"motion_hint\": \"<one sentence>\"}}"

spawn_subagent "brand-classifier" "$CLASSIFY_PROMPT" "step2-classify" 120

CLASSIFIER_OUT=$(cat "$RUN_DIR/step2-classify.visible.txt")
PARSED=$(echo "$CLASSIFIER_OUT" | python3 -c "
import json, sys, re
text = sys.stdin.read()
# Robust outer-brace extraction
depth = 0; start = -1; chosen = None
for i, c in enumerate(text):
    if c == '{':
        if depth == 0: start = i
        depth += 1
    elif c == '}':
        depth -= 1
        if depth == 0 and start >= 0:
            try:
                chosen = json.loads(text[start:i+1])
                break
            except: pass
            start = -1
if chosen:
    ms = chosen.get('matched_style')
    conf = chosen.get('confidence', 0.0)
    print(f'{ms or \"null\"}|{conf}')
    seed = chosen.get('suggested_new_style_seed', {})
    if seed:
        import json as j
        print(j.dumps(seed))
" 2>/dev/null || echo "null|0.0")

MATCHED_STYLE=$(echo "$PARSED" | head -1 | cut -d'|' -f1)
CONFIDENCE=$(echo "$PARSED" | head -1 | cut -d'|' -f2)
SEED=$(echo "$PARSED" | tail -n +2)

echo "[parsed] matched_style=$MATCHED_STYLE  confidence=$CONFIDENCE"
echo ""

# ============================================================
# Step 3 — style-author (if needed)
# ============================================================
AUTHORED_STYLE=""
if [ "$MATCHED_STYLE" = "null" ] || [ -z "$MATCHED_STYLE" ] || python3 -c "import sys; exit(0 if float('${CONFIDENCE:-0.0}') < 0.6 else 1)"; then
  echo "=== STEP 3: style-author (matched < 0.6 — authoring new style) ==="
  AUTHOR_PROMPT="You are the style-author sub-agent. The brand-classifier found no existing style fits well. Design a NEW visual style for this brand using the seed below.

Seed:
$SEED

Brand summary:
$BRAND_SHORT

Reply with ONLY a JSON object (no markdown, no preamble):
{\"name\": \"<kebab-case style id>\", \"display_name\": \"<human-readable>\", \"palette\": [\"#hex1\", \"#hex2\", \"#hex3\"], \"display_font\": \"<font name>\", \"body_font\": \"<font name>\", \"voice\": [\"<kw1>\", \"<kw2>\", \"<kw3>\"], \"motion_principles\": \"<1-2 sentences>\", \"signature_shot\": \"<one sentence describing the hero visual>\", \"scene_types\": [\"cold_open\", \"solution_reveal\", \"feature_montage\", \"cta\"]}"

  spawn_subagent "style-author" "$AUTHOR_PROMPT" "step3-author" 180

  AUTHORED=$(cat "$RUN_DIR/step3-author.visible.txt")
  AUTHORED_STYLE=$(echo "$AUTHORED" | python3 -c "
import json, sys
text = sys.stdin.read()
depth = 0; start = -1
for i, c in enumerate(text):
    if c == '{':
        if depth == 0: start = i
        depth += 1
    elif c == '}':
        depth -= 1
        if depth == 0 and start >= 0:
            try:
                d = json.loads(text[start:i+1])
                if d.get('name'):
                    print(d['name']); sys.exit(0)
            except: pass
            start = -1
" 2>/dev/null || echo "")

  if [ -n "$AUTHORED_STYLE" ]; then
    MATCHED_STYLE="$AUTHORED_STYLE"
    echo "[parsed] authored_style=$AUTHORED_STYLE — using as the design style"
  else
    MATCHED_STYLE="apple-style-30s"
    echo "[parsed] style-author returned no parseable name — fallback to apple-style-30s"
  fi
else
  echo "=== STEP 3: style-author SKIPPED (existing style matched ≥ 0.6) ==="
fi
echo ""

# ============================================================
# Step 4 — spec-composer
# ============================================================
echo "=== STEP 4: spec-composer ==="
COMPOSE_PROMPT="You are the spec-composer sub-agent. The brand below will be rendered in the '$MATCHED_STYLE' style.

Brand summary:
$BRAND_SHORT

Reply with ONLY a JSON object describing the scene plan (no markdown, no preamble):
{\"style\": \"$MATCHED_STYLE\", \"duration_seconds\": 30, \"primary_color\": \"<hex from brand palette>\", \"scenes\": [{\"act\": 1, \"type\": \"cold_open\", \"copy\": \"<short hook, ≤8 words, grounded in the brand>\", \"asset_brief\": \"<one sentence describing the visual>\"}, {\"act\": 2, \"type\": \"feature_montage\", \"copy\": \"<short feature line>\", \"asset_brief\": \"<visual>\"}, {\"act\": 3, \"type\": \"solution_reveal\", \"copy\": \"<short proof line>\", \"asset_brief\": \"<visual>\"}, {\"act\": 4, \"type\": \"cta\", \"copy\": \"<short cta>\", \"asset_brief\": \"<visual>\"}]}"

spawn_subagent "spec-composer" "$COMPOSE_PROMPT" "step4-compose" 180

# Save the spec to disk for downstream render (not invoked here)
SPEC_OUT=$(cat "$RUN_DIR/step4-compose.visible.txt")
echo "$SPEC_OUT" > "$RUN_DIR/spec.json"
echo "Spec saved to $RUN_DIR/spec.json"
echo ""

# ============================================================
# Step 5 — render-watcher (narrative)
# ============================================================
echo "=== STEP 5: render-watcher (narrative-only, render stubbed) ==="
WATCH_PROMPT="You are the render-watcher sub-agent. The render step has been stubbed for this design-level validation (no Higgsfield spend). The spec.json has been produced. The downstream render would invoke /sandbox/.openclaw/skills/promo/scripts/start_promo.sh.

Reply with exactly: STUB. Spec ready at run dir. Render would invoke start_promo.sh."

spawn_subagent "render-watcher" "$WATCH_PROMPT" "step5-watch" 60
echo ""

# ============================================================
# Step 6 — report
# ============================================================
echo "=== STEP 6: report ==="
echo "OK"
echo "URL processed: $URL"
echo "Style chosen: $MATCHED_STYLE"
if [ -n "$AUTHORED_STYLE" ]; then
  echo "  (authored on-the-fly by style-author sub-agent)"
fi
echo ""
echo "Sub-agents dispatched via openclaw agent CLI:"
echo "  - brand-classifier  -> matched=$MATCHED_STYLE confidence=$CONFIDENCE"
[ -n "$AUTHORED_STYLE" ] && echo "  - style-author      -> authored new style: $AUTHORED_STYLE"
echo "  - spec-composer     -> scene plan written to $RUN_DIR/spec.json"
echo "  - render-watcher    -> stub acknowledged"
echo ""
echo "Render: STUBBED — to produce real MP4, refresh Higgsfield creds + restore render step"
echo "Run artifacts: $RUN_DIR"
echo ""
echo "=== finished at $(date -u) ==="
