---
name: promo-sub-agent
description: Use ONLY when explicitly asked to "make a promo for X using sub-agents", "demo sub-agent architecture for X", "make a promo with delegation for X", "show agent collaboration for X", or "run the sub-agent pipeline for X". For normal "make a promo for X" requests, use the `promo` skill instead — this skill is the autonomous-architecture demo path that delegates each pipeline stage to a specialist sub-agent via sessions_spawn.
---

# Promo via Sub-Agent Architecture (Demo Path)

## When to use

ONLY trigger on these explicit phrases (or close variants):
- "make a promo for X using sub-agents"
- "demo sub-agent architecture for X"
- "make a promo with delegation for X"
- "show agent collaboration for X"
- "run the sub-agent pipeline for X"
- "URL to MP4 with sub-agents for X"

For plain "make a promo for X" without "sub-agent" in the request, use the `promo` skill instead (faster, more reliable, deterministic path).

## Overview

This skill demonstrates the sub-agent architecture documented in `/sandbox/.openclaw/workspace/TOOLS.md`. The primary agent (you) delegates each stage of the promo-video pipeline to a specialist sub-agent via `sessions_spawn`. Each sub-agent has its own fresh context, doing one focused job, then returning a small JSON result.

The 5 sub-agents are registered in `agents.list` of `openclaw.json`:
- `brand-classifier` — classify brand against existing style library
- `style-author` — design and materialize a new style if no existing one fits
- `spec-composer` — produce the CompositionSpec JSON
- `render-watcher` — poll render until terminal state
- `memory-curator` — append behavioral memory from user feedback

## Workflow

Follow the steps in `/sandbox/.openclaw/workspace/TOOLS.md` exactly. The flow is:

1. **You** run `fetch_brand.py` via `openclaw:core:exec`:
   ```
   tool: openclaw:core:exec
   command: python3 /sandbox/.openclaw/skills/promo-research/scripts/fetch_brand.py "$URL"
   ```

2. **You** `sessions_spawn brand-classifier` with the captured brand summary + list of existing styles. Wait for JSON.

3. **Branch** on `matched_style` and `confidence`. If no match, `sessions_spawn style-author` to author a new one.

4. **You** `sessions_spawn spec-composer` with the chosen style. It writes `/sandbox/spec.json`.

5. **You** fire the existing async render:
   ```
   tool: openclaw:core:exec
   command: bash /sandbox/.openclaw/skills/promo/scripts/start_promo.sh "$URL" /sandbox/out.mp4
   ```
   (Note: start_promo.sh internally uses its own composition path. For the sub-agent demo we want it to use the spec we just composed — pass the spec via an env var or edit the wrapper. For the first demo iteration, accept that the agent's spec gets overwritten by start_promo.sh's spec; the value is in showing the sub-agent dispatches.)

6. **You** `sessions_spawn render-watcher` with `/sandbox/render.status`. Wait for terminal.

7. **You** report the MP4 path + which style was used + which sub-agents were invoked + whether a new style was authored.

## Hard rules (same as TOOLS.md)

- Do NOT do the sub-agent's work yourself. Spawn it.
- Do NOT wrap `openclaw:core:exec` inside `tool_search_code` JS.
- Call `openclaw:core:exec` and `sessions_spawn` directly as top-level tool invocations.
- If a sub-agent times out, retry ONCE with a clearer prompt; otherwise report failure and stop.

## Reporting the result

At the end of a successful run, your reply to the user should explicitly mention:
- The MP4 path + file size
- Which style was used (and whether it was newly authored)
- A one-line trace: "Dispatched: brand-classifier → [style-author] → spec-composer → render-watcher"

This makes the sub-agent collaboration visible to the user (and to anyone watching the demo screencast).

## Known caveat for first iteration

The existing `start_promo.sh` builds its own spec internally and saves to `/sandbox/spec.json`, overwriting any spec the `spec-composer` sub-agent produced. For the first demo, this is acceptable — the value of the sub-agent demo is in showing **the dispatch pattern works**, not yet in showing the spec-composer's output drives the render.

A clean v2 will replace `start_promo.sh` with a variant that respects an existing `/sandbox/spec.json`. That's a 1-line bash change but deferred to a follow-up.
