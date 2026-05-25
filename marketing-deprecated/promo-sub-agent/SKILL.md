---
name: promo-sub-agent
description: Use ONLY when explicitly asked to "make a promo for X using sub-agents", "demo sub-agent architecture for X", "make a promo with delegation for X", "show agent collaboration for X", or "run the sub-agent pipeline for X". Calls ONE bash script that internally dispatches to 5 specialist sub-agents (brand-classifier, style-author, spec-composer, render-watcher, memory-curator) via the openclaw agent CLI. Returns the MP4 path when done.
---

# Promo via Sub-Agent Architecture (Demo Path)

## How you invoke this

You will make exactly TWO `openclaw:core:exec` tool calls. Nothing else.

### Call 1 — fire the pipeline

```
TOOL: openclaw:core:exec
ARGS: {"command": "bash /sandbox/.openclaw/skills/promo-sub-agent/scripts/run.sh <URL>"}
```

This script will:
1. Run `fetch_brand.py` to extract brand summary
2. Invoke `brand-classifier` sub-agent (via `openclaw agent --agent brand-classifier`) to pick a style
3. Invoke `spec-composer` sub-agent for narrative
4. Fire `start_promo.sh` (proven render pipeline)
5. Invoke `render-watcher` sub-agent (it narrates while the script polls render.status)
6. Print `MEDIA:/sandbox/out.mp4` on success or `FAILED` with the log tail on failure

Typical runtime: 5–10 minutes. The script blocks until done.

### Call 2 — confirm and report

The Call 1 stdout already contains all the trace. Just read it, then tell the user:
- The MP4 path
- The style that was used
- The sub-agents that were dispatched (named in the trace)

## Why this is one bash call, not five sessions_spawn calls

`sessions_spawn` requires `tools.toolSearch: false` (which needs a sandbox restart to apply) AND requires the agent to call `sessions_spawn` as a top-level tool. Nemotron 3 Super 120B kept wrapping it in `tool_search_code` with wrong JS API and failing.

The bash script sidesteps both: it calls `openclaw agent --agent <id> -m "..."` directly inside the sandbox — the SAME runtime that `sessions_spawn` would use, just reached via CLI instead of from inside an agent turn. Each sub-agent still gets its own fresh context (proves the isolation claim) and runs on the right model. The architecture story is preserved, the runtime invocation works.

## Hard rules

- Make exactly ONE `openclaw:core:exec` call with the bash script. Do NOT try to call sub-agents from your agent turn directly.
- Do NOT wrap the call in `tool_search_code` JavaScript.
- Do NOT call any other tool until that first call returns.
- The script's stdout IS the full trace — quote relevant lines back to the user; don't paraphrase.
- If the script returns `FAILED`, surface the log tail verbatim to the user. Do not retry from your side.

## Example output the user will see in your reply

> Done. MP4 rendered at `/sandbox/out.mp4` (2.8 MB, apple-style-30s).
> 
> Sub-agents dispatched: brand-classifier (matched apple-style-30s, confidence 0.82) → spec-composer (narrative confirmed) → render-watcher (observed render through to done).
> 
> Full trace in `/sandbox/sub-agent-runs/<timestamp>/run.log`.
