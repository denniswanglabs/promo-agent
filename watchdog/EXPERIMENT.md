# Autonomous Render Experiment — 2026-05-24 21:34

**Goal Dennis set:** I prompt OpenClaw automatically, read what it's doing while running, evaluate result, fix + re-prompt if wrong. Two tries while he showers.

## What worked

- **Infrastructure is solid.** Every fix from today held: sandbox auth, network policies, Higgsfield CLI, Remotion + Chrome + ffmpeg, async wrapper, jq URL fix, scene_1 cached. None of these were the blocker.
- **`openclaw agent --message ... --session-id ...` CLI works** as a non-interactive entry point. Can be driven from `nemoclaw exec`.
- **`thinkingDefault` must be `adaptive`** (not `auto` — that fails config validation).

## What blocked iteration 1

**Agent stuck in a tool-discovery loop.** Transcript at `/sandbox/.openclaw/agents/main/sessions/exp-iter1-1779629934.jsonl`:

- Agent tried `await openclaw.tools.call('exec', { command: '...' })`
- Every variant returned `{"ok": true, "value": null, "logs": [], ...}`
- Agent reasoned correctly: "the tool is returning a placeholder or not implemented correctly"
- Burned ~7+ Nemotron inference calls trying different patterns
- Never fired the wrapper script
- I killed the run after ~12 minutes

**Root cause:** The agent guessed the tool name as `'exec'`. The real tool ID is `'openclaw:core:exec'` (found by grepping `/usr/local/lib/node_modules/openclaw` for `openclaw:` patterns). Nemotron 120B doesn't have OpenClaw's tool catalog memorized.

## What's pending in iteration 2

Same wrapper invocation, but the prompt now names the tool explicitly:

> "Call the tool openclaw:core:exec with this command exactly: bash /sandbox/.openclaw/skills/render-promo/scripts/render_promo_async.sh /sandbox/spec.json /sandbox/out.mp4 — and report what stdout it returned. Single tool call. Do not poll, do not loop."

Iter 2 was kicked off at ~21:53. Monitor armed to wake me when `render.status` reaches `done` or `failed`.

## The structural problem this experiment exposed

**Nemotron 120B + OpenClaw's tool surface is fragile for shell orchestration.**

- OpenClaw exposes 28 tools with FQN like `openclaw:core:exec`, `openclaw:core:process`, etc.
- The agent uses `tool_search_code` (a JS sandbox) to call them via `openclaw.tools.call(<id>, <args>)`
- The JS runtime lacks `require` (no Node stdlib) — must use the bridge
- Nemotron 120B has to either:
  1. Know the tool name (it doesn't — guesses wrong)
  2. Discover it via `openclaw.tools.search` (the agent tried this earlier and got query-format errors)
  3. Be told explicitly in the prompt or SKILL.md

Option 3 is the only reliable path. Every SKILL.md going forward should name the exact OpenClaw tool ID to call. Or our skills should be invoked through a different mechanism entirely (e.g. the agent runs a single registered `bash_skill` tool that takes a command).

## Recommendations for tomorrow

1. **Document the tool catalog** — get the full list of 28 OpenClaw tools with their schemas. Pin it in `agent/OPENCLAW_TOOLS.md` for prompt reference.
2. **Rewrite SKILL.md files to name exact tool IDs.** Every script invocation should say "use openclaw:core:exec with this command...".
3. **Consider building a custom OpenClaw extension** that exposes a single `promo:render` tool taking only `{ spec_path, out_path }` — way cleaner than the agent assembling shell commands.
4. **Don't run the agent autonomously yet.** It's still a research project. Watchdog + manual dashboard prompts is the right cadence until the tool surface is reliable.

## Cost summary tonight

- Credits before iter 1: 1608.34
- Credits after iter 1: 1608.34 (no Higgsfield calls — agent never fired the script)
- Credits after iter 2: 1608.34 (same — same failure mode at the tool-bridge layer)
- **Total experiment cost: $0** — neither iteration ever reached the part that costs money

## Iteration 2 result

Same blocker as iter 1, one layer deeper. Even with `openclaw:core:exec` named in the prompt, the agent could not figure out the correct `openclaw.tools.call(...)` JS bridge syntax. Errors like `"call id must be a string"` showed the bridge expects a different parameter shape than the obvious `(tool_name, args)`.

Agent's own reasoning at iter 2 end (literal quote from session log):

> "We need to use openclaw.tools.call with tool: 'openclaw:core:exec' and input: { command: '...' }. However earlier we attempted that but got error 'call id must be a string.' Possibly the tool expects a different structure?"

Stopped iter 2 at ~6 min in. Killed the openclaw agent CLI. Monitor task stopped.

## Outcome of experiment

**0 MP4s. 0 credits spent. 2 iterations exhausted on the same fundamental issue.**

The autonomous render loop is NOT ready. Nemotron 120B cannot reliably invoke `openclaw:core:exec` through the JS bridge without explicit syntax in the prompt — and even with the tool name, the call-shape is wrong. This isn't a Nemotron quality issue; it's a NemoClaw-side documentation/API ergonomics gap that the agent's training doesn't fill.

## Path forward (tomorrow, when Dennis is back)

Three options, in order of effort:

1. **Reverse-engineer the JS bridge syntax** by reading openclaw's source at `/usr/local/lib/node_modules/openclaw/` for the actual `openclaw.tools.call` signature, then pin the exact JS snippet in every SKILL.md.
2. **Bypass the JS bridge** — register a custom OpenClaw "command" tool that takes `{ command: string }` directly, so the agent gets shell exec as a top-level tool (no `tool_search_code` indirection). This is the cleanest architectural fix.
3. **Use the dashboard path only.** The dashboard's chat interface lets Nemotron invoke `openclaw:core:process` correctly (we saw it succeed earlier with the iter 0 attempt that submitted Higgsfield jobs). CLI-based driving doesn't work because the agent has a smaller tool prompt. Just have the user paste prompts manually; the watchdog catches results when they appear.

## Recommended next move

**Option 3 for tomorrow.** Use the dashboard, paste the render prompt manually, let the watchdog capture + review. We've already proven the dashboard path partially works (it submitted Higgsfield jobs earlier today). The jq fix is in. Scene 1 is cached. A fresh dashboard session is the lowest-friction path to a working MP4.

Then post-hackathon: option 2 (custom command tool) for production.

---

## UPDATE 22:00 — Dashboard automation via Chrome MCP IS WORKING

Reversed direction: Chrome MCP extension was actually online (the wake script's diagnostic was overly pessimistic). Drove the dashboard chat directly via Chrome MCP `computer:type` + `key:Return`. React input accepted real keystrokes cleanly.

### Iteration 1 (dashboard via Chrome MCP)

- Sent: `Run this shell command in the background and report what stdout it returns: bash /sandbox/.openclaw/skills/render-promo/scripts/render_promo_async.sh /sandbox/spec.json /sandbox/out.mp4`
- Agent fired the wrapper via dashboard ✓ (this is what the CLI path couldn't do)
- Script ran:
  ```
  ==> spec has 5 scenes
  ==> scene_1 asset cached at /sandbox/promo-render/public/scene_1.png  (cache hit!)
  ==> scene_2: generating image via Higgsfield...
  ERROR: Higgsfield generate failed for scene_2
  Error: Session expired.
  ```
- **New blocker: Higgsfield session token expires within ~30 min. Re-injecting from host fixes it.**
- Auto-fix applied: re-injected fresh credentials via base64-stdin

### Iteration 2 (in flight as of 22:01)

- Same session, sent: `Auth was refreshed externally. Please retry the exact same command: bash /sandbox/.openclaw/skills/render-promo/scripts/render_promo_async.sh /sandbox/spec.json /sandbox/out.mp4`
- Agent processing now
- Monitor armed (`btq9jnj6j`) for terminal state — fires on `done` or `failed`
- Expected duration: 8-12 min for full pipeline (4 gens + render, scene_1 cached)
- Expected cost: $3-6

### Lessons

1. **Dashboard path is the working autonomous loop.** Chrome MCP can drive it. CLI agent path is broken at the tool-bridge layer.
2. **Higgsfield token refresh inside the sandbox is fragile.** Need to add a `higgsfield account status` step at the start of `render_promo.sh` to force refresh, OR write a host-side cron that re-injects credentials every 20 min.
3. **The fix-and-retry loop works.** Iter 1 produced a clear, debuggable error. External fix applied. Iter 2 sent. Real autonomous loop pattern.
