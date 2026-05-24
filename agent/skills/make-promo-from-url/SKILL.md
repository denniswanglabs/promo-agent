---
name: make-promo-from-url
description: Use when asked to "make a promo video for <URL>", "create a promo for <company>", "video for <site>", or any one-shot request to produce a promo MP4 from just a company URL. Chains promo-research (URL → CompositionSpec JSON) and render-promo (spec → assets → MP4) into one autonomous run. Use when the user gives a URL and wants a finished video, not a spec or research output.
---

# Make Promo From URL — End-to-End

## Overview

Take a company URL, produce a finished MP4. This skill chains two existing skills:

1. **promo-research**: fetch the URL, extract brand tokens, produce a CompositionSpec JSON
2. **render-promo**: take that spec, generate Higgsfield assets, render via Remotion

The whole pipeline takes 8-15 min and costs ~$3-5 in Higgsfield credits.

## When to use

Trigger this skill on requests like:
- "make a promo video for https://buildtrayd.com"
- "create a promo for benchling.com"
- "video for kolr.ai"
- "render a promo for [company] using the site at [url]"
- "URL in, MP4 out for [link]"

## Workflow — execute in order

### Step 1: Research the brand and build a spec

Run the brand-research helper:

```bash
python3 /sandbox/.openclaw/skills/promo-research/scripts/fetch_brand.py "$URL"
```

This prints structured sections (TITLE, DESCRIPTION, PALETTE, FONTS, INTERNAL_LINKS, BODY_TEXT). Read the output carefully.

### Step 2: Compose the CompositionSpec JSON yourself based on Step 1's output

You — the agent — produce the JSON. Use the same rules as the promo-research skill:

- Pick a template from: `apple-style-30s`, `kinetic-light-59s`, `zelios-53s`, `freeform`
- Output 4-5 scenes
- First scene is `cold_open` or `problem`, last is `cta`, include `social_proof` if real customers are named in the fetched text
- Each scene has: `act`, `duration_f` (frames at 30fps), `type` (one of: cold_open, problem, solution_reveal, feature_montage, social_proof, cta), `copy` (1-2 short lines, ≤8 words each, no marketing fluff like "revolutionary"), `asset_brief` (Higgsfield prompt referencing the brand's palette), `asset_type` ("image" or "video")
- Total `duration_f` should sum near 900 (30s) for apple-style
- Use the brand's primary + accent hex colors verbatim in every asset_brief
- Ground every claim in the fetched text — no invented stats, no fabricated customer names

### Step 3: Save the spec to /sandbox/spec.json

Use the openclaw:core:exec tool with this exact shell command (substitute your JSON):

```bash
cat > /sandbox/spec.json <<'SPECEOF'
<your CompositionSpec JSON here>
SPECEOF
```

Or use `echo` with a single-line JSON payload. Either works.

### Step 4: Clear any previous render state

```bash
rm -f /sandbox/render.status /sandbox/render.log /sandbox/render.pid /sandbox/out.mp4
```

### Step 5: Fire the render pipeline (background)

```bash
bash /sandbox/.openclaw/skills/render-promo/scripts/render_promo_async.sh /sandbox/spec.json /sandbox/out.mp4
```

Returns immediately with PID + log path.

### Step 6: Poll status until done or failed

```bash
cat /sandbox/render.status
```

Possible values: `starting`, `done`, `failed exit=<code>`.

Wait 60 seconds between polls. Don't spam.

If status remains `starting` for >12 minutes, run:
```bash
tail -30 /sandbox/render.log
```
to see what step is taking long.

### Step 7: Report the result

When status is `done`:

```bash
ls -lh /sandbox/out.mp4
/sandbox/.local/bin/higgsfield account status
```

Tell the user:
- The MP4 path and file size
- The Higgsfield credit balance (before/after if you captured baseline)
- Any warnings or fallbacks visible in `/sandbox/render.log`

When status is `failed`:

```bash
tail -50 /sandbox/render.log
```

Report the failing step and the error message. Do NOT auto-retry the whole pipeline — surface the error so the user can fix it.

## Rules

- Don't fabricate brand details. If `fetch_brand.py` fails or returns sparse output, report that and stop. Don't make up customers, stats, or quotes.
- Use the brand's actual palette colors in every `asset_brief`. Generic prompts produce generic-looking videos.
- Output a single JSON code block in Step 2 — no preamble, no postscript, no explanation. Save it directly to /sandbox/spec.json.
- The render step uses real money (Higgsfield). Don't re-fire the whole pipeline on a recoverable failure (auth, network); surface the error and let the user decide.
- Total pipeline cost: $3-5 typically. If you see >$10 spend in one task, something is wrong — stop and report.

## Self-check before reporting done

1. [ ] Does `/sandbox/out.mp4` exist and is it >1 MB?
2. [ ] Did you check `/sandbox/.local/bin/higgsfield account status` to capture the credit delta?
3. [ ] Did you report the brand name + a one-line summary of what's in the video?

If any check fails, fix it before claiming done.
