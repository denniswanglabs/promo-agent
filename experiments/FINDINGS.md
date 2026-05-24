# Dashboard agent reliability — A/B findings

**Date:** 2026-05-25 (overnight)
**Goal:** find a SKILL.md prompt that makes the OpenClaw dashboard agent reliably call `openclaw:core:exec` and produce an MP4.

## Root cause(s) discovered

The drift is **not** a single problem — it's three stacked issues:

### 1. Stale skill registry in the sandbox

The sandbox had three earlier-iteration skills sitting in `~/.openclaw/skills/`:
- `make-promo-from-url` (from initial spike)
- `render-promo` (Higgsfield-asset mode, deferred)
- `promo` (current)

The agent's skill discovery picked up the older skills first and targeted their (now-invalid) paths. **Fix:** removed `make-promo-from-url` and `render-promo` from the sandbox so only `promo` + `promo-research` remain.

### 2. Nemotron 3 Super 120B wraps bash in `tool_search_code` JS

Observed pattern from sandbox logs:

```js
await openclaw.tools.call('openclaw:core:exec', {
  command: 'bash /sandbox/.openclaw/skills/render-promo/scripts/render_promo.sh ...'
});
```

The agent wraps every `openclaw:core:exec` call inside a `tool_search_code` JavaScript invocation. The JS sandbox has a ~30 sec timeout. Our `make_promo.sh` takes ~90 sec — so the JS times out and the agent retries (often targeting the stale skill path).

SKILL.md text instructions ("do not use tool_search_code", "call openclaw:core:exec directly") did not override this pretrained pattern in the variants tested (v1–v7).

### 3. Agent context cache persists across "New session"

Clicking "New session" in the dashboard clears the visible chat but does **not** refresh the agent's cached tool/skill registry. After deleting the stale skills, subsequent messages still showed the agent targeting `/sandbox/.openclaw/skills/render-promo/...`. A full agent-runtime restart (or `nemoclaw promo-agent rebuild`) is needed to refresh the cache.

## Variants tested

| Variant | Approach | Result |
|---|---|---|
| v1 (baseline) | "Call exactly ONE tool: openclaw:core:exec with command X" | Drift — wrapped in tool_search_code, timeout |
| v2 (explicit forbid) | Added "DO NOT call tool_search_code" | Same drift |
| v3 (example call) | Showed literal openclaw:core:exec JSON shape | Same drift |
| v4 (minimal) | One-line instruction | Same drift |
| v5 (imperative) | Numbered steps | Same drift |
| v6 (thinking off) | `detailed thinking off` preamble | Same drift |
| v7 (async architecture) | Split into start_promo.sh (returns <2s) + wait_promo.sh (polls ≤25s) — both fit JS sandbox timeout | Installed but not validated tonight due to cached skill registry |

## Structural fix shipped (v7)

Even without resolving the agent-cache issue tonight, the v7 architecture is a real improvement for next time:

- `agent/skills/promo/scripts/start_promo.sh` — backgrounds make_promo.sh, returns in <50ms
- `agent/skills/promo/scripts/wait_promo.sh <SEC>` — polls `/sandbox/out.mp4` up to N sec then exits with DONE or PENDING

This pairs well with any agent that has a JS sandbox timeout: each call fits comfortably.

## Recommendation for the hackathon demo

**Use the CLI path as the primary demo.** It is reliable, proven on 9 brands tonight, ~90 sec end-to-end:

```bash
nemoclaw promo-agent exec -- bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh https://stripe.com /sandbox/out.mp4
```

Mention the dashboard path in the screencast as "for autonomous deployments — the agent loop is the same flow, gated by NemoClaw's policy file". Don't try to live-demo the dashboard.

## Next attempts (post-hackathon)

1. Restart the agent runtime cleanly (`nemoclaw promo-agent rebuild`) before re-testing v7.
2. Investigate disabling `tool_search_code` in the OpenClaw agent config — that single change might fix everything.
3. Test alternative models: Nemotron Nano (smaller, possibly less likely to wrap in JS).
4. Try a custom OpenClaw plugin that registers a single-purpose tool (per `nemoclaw-user-reference` skill, `registerTool` may not be exposed, but `registerCommand` could route to bash).
