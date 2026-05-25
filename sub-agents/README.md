# Sub-Agent Architecture

Adapted from NVIDIA's [vlm-demo](https://github.com/brevdev/nemoclaw-demos/tree/main/vlm-demo) sub-agent pattern (docs: [nemoclaw-user-configure-inference/set-up-sub-agent](https://docs.nvidia.com/nemoclaw/)).

## Why

The primary agent (Nemotron 3 Super 120B) is a generalist with a 131K context window. Loading 5+ multi-step skills into that window simultaneously causes prompt-token usage to spike — seen empirically on 2026-05-25 01:55:37 in `/tmp/gateway.log`: *"LLM timed out with high prompt token usage (183%)"*. The model was overflowing capacity trying to orchestrate the whole pipeline in its own head.

Sub-agents fix this two ways:
1. **Context isolation per task** — each sub-agent runs in its own fresh OpenClaw session, sees only its task input, returns a small JSON result.
2. **Specialized prompts per role** — each sub-agent's instructions are 50-100 lines of focused guidance, not 1600 lines of every-possible-task.

Primary agent's job collapses from "orchestrate the whole pipeline in your context" to "call `fetch_brand.py` → spawn 3-4 sub-agents → fire render → report."

## Architecture

| Sub-agent | Job | Output |
|---|---|---|
| `brand-classifier` | Pattern-match brand against existing style library | JSON: matched_style, confidence, optional new-style seed |
| `style-author` | Design + materialize a new style (only when classifier returns no match) | JSON: authored_style_name, manifest_path |
| `spec-composer` | Build the CompositionSpec from brand + chosen style | `/sandbox/spec.json` + JSON summary |
| `render-watcher` | Poll `/sandbox/render.status` until terminal state | JSON: status, mp4_path or log_tail |
| `memory-curator` | Append behavioral memory bullets from user feedback | confirmation JSON |

All sub-agents currently run on the SAME model (`inference/nvidia/nemotron-3-super-120b-a12b`) for MVP simplicity. Future iteration: smaller models (Nemotron 3 Nano 4B) for `brand-classifier` and `memory-curator`, where 120B is overkill.

## Files in this directory

| Path | Purpose |
|---|---|
| `openclaw.json.with-subagents` | The patched openclaw.json with `agents.list` populated |
| `TOOLS.md` | Delegation instructions installed into `/sandbox/.openclaw/workspace/TOOLS.md` |
| `backups/openclaw.json.pre-subagent.*` | Pre-patch snapshot for rollback |

## How it was installed (2026-05-25, ~02:07 UTC)

```bash
# 1. Snapshot current sandbox config to local backup
nemoclaw promo-agent exec -- cat /sandbox/.openclaw/openclaw.json \
  > sub-agents/backups/openclaw.json.pre-subagent.$(date +%Y%m%d-%H%M%S)

# 2. Patch the config (5 sub-agents added to agents.list)
python3 build_patched_config.py  # or do by hand from the backup

# 3. Push via stdin (avoids large-arg hangs)
cat sub-agents/openclaw.json.with-subagents | nemoclaw promo-agent exec -- \
  bash -c "cat > /tmp/openclaw-new.json && mv /tmp/openclaw-new.json /sandbox/.openclaw/openclaw.json"

# 4. Update the trust-anchor hash
nemoclaw promo-agent exec -- bash -c \
  "cd /sandbox/.openclaw && sha256sum openclaw.json > .config-hash"

# 5. Push TOOLS.md
cat sub-agents/TOOLS.md | nemoclaw promo-agent exec -- \
  bash -c "cat > /sandbox/.openclaw/workspace/TOOLS.md"

# 6. Verify gateway hot-reload (look for "config hot reload applied (agents.list)")
nemoclaw promo-agent exec -- tail /tmp/gateway.log

# 7. Install the sub-agent demo SKILL
nemoclaw promo-agent skill install agent/skills/promo-sub-agent
```

## Schema gotcha discovered during install

The first patch was rejected by the gateway with:
```
[reload] config reload skipped (invalid config):
  agents.list.0: Unrecognized keys: "timeoutSeconds", "skipBootstrap"
```

`timeoutSeconds` and `skipBootstrap` are valid in `agents.defaults` but NOT in `agents.list[i]`. Per `nemoclaw/src/commands/migration-state.ts`, the recognized list-entry keys are: `id`, `description`, `model`, `workspace`, `agentDir`. Other defaults-only fields silently propagate through inheritance.

## Manual test (run from Telegram or dashboard)

Run normal path (regression check, uses deterministic `promo` skill):
> `make a promo for stripe.com`

Run sub-agent demo path (NEW):
> `make a promo for stripe.com using sub-agents`

Or to demonstrate self-extension with a novel brand:
> `demo sub-agent architecture for patek.com`

**What success looks like in `/tmp/gateway.log`:**
- Lines mentioning `sessions_spawn` invocations
- New sessions under `/sandbox/.openclaw/agents/brand-classifier/sessions/`, `/spec-composer/sessions/`, etc. (created lazily on first spawn)
- Each sub-agent session shorter than the primary's (proves context isolation)
- No `prompt token usage` warnings (proves capacity headroom)
- Render completes with the new architecture, MP4 lands

## Coexistence with existing `promo` skill

The deterministic `promo` SKILL (37 lines, c4baa32f's Phase 2 work) remains untouched. It's the proven path that rendered all 13 gallery MP4s. The new `promo-sub-agent` SKILL triggers ONLY on explicit phrases like "using sub-agents" / "demo sub-agent architecture for" — so plain "make a promo for X" still goes to the reliable deterministic path.

Submission demo:
- **Reliability proof** = the 13-brand gallery (via `promo` skill)
- **Autonomy proof** = ONE recorded run via `promo-sub-agent` skill on a novel brand (shows the 5 sub-agents collaborating)

## Rollback

If the sub-agent path causes any issue:

```bash
# Restore the pre-subagent openclaw.json
cat sub-agents/backups/openclaw.json.pre-subagent.20260525-100019 | \
  nemoclaw promo-agent exec -- bash -c \
  "cat > /tmp/restore.json && mv /tmp/restore.json /sandbox/.openclaw/openclaw.json && \
   cd /sandbox/.openclaw && sha256sum openclaw.json > .config-hash"

# Optionally uninstall the demo SKILL
nemoclaw promo-agent exec -- rm -rf /sandbox/.openclaw/skills/promo-sub-agent
```

Gateway hot-reloads on next file change. No restart needed.
