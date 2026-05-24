# Investigation — Why render-promo Has Failed 5+ Times

**Date:** 2026-05-24 21:30
**Total credits wasted:** ~50-100 (estimated 5-8 image regenerations)
**Outputs produced:** 0 MP4s, 0 saved assets

## Root cause: jq query bug in `render_promo.sh`

The script extracts the asset URL from Higgsfield's JSON response with:

```bash
url=$(echo "$result" | jq -r '... | .. | .url? // empty | select(. != null)' | grep -E '^https?://' | head -1)
```

**Problem:** Higgsfield's API returns the URL in a field called `result_url`, NOT `url`:

```json
{
  "id": "7a04eb5e-8095-4961-931c-c2c9ba3d3b4d",
  "status": "completed",
  "result_url": "https://d8j0ntlcm91z4.cloudfront.net/.../hf_*.png",
  ...
}
```

The keys are: `created_at, display_name, id, job_set_type, params, result_url, status` — no `url` anywhere.

So `.url?` returns null/empty for every node in the response. `$url` is empty. The script hits:

```bash
if [ -z "$url" ]; then
    echo "ERROR: no URL parsed from Higgsfield output for scene_$idx" >&2
    exit 1
fi
```

…and exits. The Higgsfield generation was already paid for (~$0.50-1 per image) but the URL is never extracted, never downloaded, never used. Agent retries the script, regenerates again, fails again. Same pattern, 5-8 times.

## Why we didn't see the ERROR

Three reasons combined:

1. **OpenClaw's bash invocation buffers stdout** — agent doesn't see the script's `echo "ERROR:"` until the bash process terminates
2. **Script exits via `set -euo pipefail`** so the error goes to stderr but the exit code is silently propagated to a background process
3. **Agent uses `tool_search_code` (JS sandbox)** as its primary execution path — not a plain Bash tool — which adds another buffering layer
4. **The agent's `delivery-mirror` (OpenClaw's session pipeline) crashes BEFORE the script's stderr makes it to the chat** — that's the "⚠️ Something went wrong" message, which is NOT the Nemotron model failing

Net effect: silent failure mode that looks like "agent hung."

## Secondary issues (already addressed)

| Issue | Fix | Status |
|---|---|---|
| Provider timeout 180s default | Set `models.providers.inference.timeoutSeconds: 600` | ✓ applied |
| CloudFront subdomain not whitelisted | Added `d8j0ntlcm91z4.cloudfront.net` to higgsfield policy | ✓ applied |
| Sync execution model blocks agent | Added `render_promo_async.sh` wrapper | ✓ written, not yet exercised |
| Extended thinking disabled | Set `thinkingDefault: "auto"` | ✓ applied |
| `binaries: { path: <specific> }` fails for spawned subprocesses | Use `binaries: { path: "/**" }` in all custom presets | ✓ applied (every custom preset) |

None of those were the actual blocker for producing an MP4. The jq bug is the blocker. All other fixes were necessary but not sufficient.

## Tertiary issues (not yet addressed)

| Issue | Possible fix |
|---|---|
| OpenClaw `delivery-mirror` crashes mid-conversation | Unknown cause. Suspect message-size limit or session token budget. Workaround: agent uses `/new` to reset session. |
| `tool_search_code` is a JS sandbox without `require` (Node.js) | Avoid Node patterns in agent's tool code; stick to `openclaw.tools.call(...)` patterns the agent already knows. |
| Script errors get captured into `$result` then discarded | Add explicit `echo "$result" | head -5 >&2` on every Higgsfield call so the agent CAN see what Higgsfield returned even on success path. |
| No per-step progress in `render_promo.sh` | Add `echo "==> [progress] ..."` between every meaningful step so the log shows steady forward movement. |
| `nemoclaw exec` rejects multi-line bash args | Avoid heredocs in our scripts; always use single-line bash -c or external script files. |

## What actually got executed (timeline)

| Wall time | Event |
|---|---|
| 20:25 | Render-promo skill + async wrapper installed |
| 20:47 | Render attempt 1 — Nemotron 180s provider timeout (no Higgsfield call) |
| 20:51 | Provider timeout patched to 600s |
| 20:54 | Render attempt 2 — agent calls bash, Higgsfield generations succeed, downloads fail (CloudFront blocked), agent retries 3x then OpenClaw crashes |
| 21:06 | CloudFront subdomain added to policy |
| 21:18 | Render attempt 3 — agent kicks off background script via `openclaw:core:process`, multiple Higgsfield gens succeed (~42 credits, ~5 images), STILL no files because of jq bug, OpenClaw crashes mid-reasoning |
| 21:23 | Async wrapper + thinking-mode patches applied |
| 21:30 | This investigation |

## The fix

One-line change to `render_promo.sh`:

```diff
- url=$(echo "$result" | jq -r 'if type=="array" then .[0] else . end | .. | .url? // empty | select(. != null)' | grep -E '^https?://' | head -1)
+ url=$(echo "$result" | jq -r 'if type=="array" then .[0] else . end | .. | (.result_url? // .url?) // empty | select(. != null)' | grep -E '^https?://' | head -1)
```

This makes the recursive descent look for EITHER `result_url` OR `url` (future-proofing in case Higgsfield ever renames).

Plus a defensive `echo "$result" | head -3 >&2` after the Higgsfield call so we never have a silent-failure mode again.

## Recommended next steps

1. **Apply the jq fix** — one line
2. **Reinstall the skill**
3. **Save the 5 already-generated "Overwhelmed contractor" images** from CloudFront (host has unrestricted net) → drop one into `/sandbox/promo-render/public/scene_1.png` so we don't burn credit #6 on it
4. **Retry render via the async wrapper** — should now actually produce assets and an MP4
5. **Don't expect zero issues** — Seedance video (scene 3) might surface another CDN domain or response field we haven't seen yet. Watch closely.
6. **Use the watchdog cron** to catch the run automatically on the next 10-min tick

## Estimated remaining cost to a working MP4

- 0 credits if we use the already-paid scene_1 image
- ~$2-3 for scenes 2, 4, 5 (gpt_image_2 × 3)
- ~$1-2 for scene 3 (Seedance video × 1)
- **Total: ~$3-5 to first working MP4**

## Estimated wasted cost so far

~$5-15 across 5-8 Higgsfield generations that produced files Higgsfield kept but the script never downloaded.
