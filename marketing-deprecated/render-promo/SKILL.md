---
name: render-promo
description: Use when asked to render a promo video from a CompositionSpec JSON. Default spec path is /sandbox/spec.json. Output to /sandbox/out.mp4. Uses Higgsfield for asset generation and Remotion for the final render. Use when user says "render the promo", "make the video", "render spec.json", or similar. The render takes 6-10 min — runs in the background, you poll the log to track progress.
---

# Render Promo Video (background mode)

## Overview

You render a promo video from a `CompositionSpec` JSON (default: `/sandbox/spec.json`).
The render takes 6-10 minutes (5 Higgsfield generations + Remotion render),
so it MUST run in the background. You fire it once, then poll a log file
to watch progress.

## Workflow — do these steps in order

### Step 1: Start the background render

```bash
bash /sandbox/.openclaw/skills/render-promo/scripts/render_promo_async.sh /sandbox/spec.json /sandbox/out.mp4
```

This returns IMMEDIATELY with a PID + log path. It does NOT block.

### Step 2: Poll the status file

```bash
cat /sandbox/render.status
```

Possible values: `starting`, `running`, `done`, `failed exit=<code>`.

If `done`: skip to Step 4.
If `failed`: read the log (Step 3) and report the error.
Otherwise: continue polling.

### Step 3: Check progress

```bash
tail -30 /sandbox/render.log
```

Look for lines like:
- `==> scene_N: generating image via Higgsfield...` — image gen in flight
- `    download: ...` — Higgsfield returned URL, downloading
- `==> all N assets ready` — moving to render phase
- `==> rendering...` — Remotion CLI running
- `==> DONE: /sandbox/out.mp4 (NNN MB)` — render complete
- `ERROR: ...` — something failed

### Step 4: Poll loop

Repeat steps 2 and 3 every 30-60 seconds until status becomes `done` or `failed`.
Each `cat` and `tail` call returns instantly — they don't block.

**Important:** Wait at least 30 seconds between polls. Generation takes time.
Don't spam-poll.

### Step 5: Final report

When status is `done`:

```bash
ls -lh /sandbox/out.mp4
/sandbox/.local/bin/higgsfield account status
```

Report to the user:
- Output path + size
- Final Higgsfield credit balance
- Any warnings from the log (grep for "WARN" or "fallback")

When status is `failed`:

Read the full log, report the failing step + error message. Do NOT retry
automatically — surface the error to the user first.

## Manual recovery (only if asked)

If you need to run synchronously (not recommended — long blocking call):

```bash
bash /sandbox/.openclaw/skills/render-promo/scripts/render_promo.sh /sandbox/spec.json /sandbox/out.mp4
```

## Tools you have

- `higgsfield` CLI at `/sandbox/.local/bin/higgsfield`
- Remotion stack at `/sandbox/promo-render/`
- ffmpeg at `/sandbox/promo-render/node_modules/ffmpeg-static/ffmpeg`
- Chrome headless shell at `/sandbox/promo-render/node_modules/.remotion/.../headless_shell`

## Rules

- **Always use the async wrapper for production renders.** The sync script blocks too long.
- **Don't kill the background process** unless explicitly asked. Killing mid-Higgsfield call wastes credits.
- **Don't re-trigger if a render is already running** — check `/sandbox/render.status` first.
- **Don't fabricate.** If a step fails twice, report it and stop.
