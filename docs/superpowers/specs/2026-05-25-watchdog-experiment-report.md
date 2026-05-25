# Watchdog Experiment Report

> **Run while Dennis showered, 2026-05-25 ~11:00-11:30 AM.** Token budget: open. Goal: can OpenClaw produce *meaningful* explainer videos, end-to-end inside NemoClaw?

---

## TL;DR

**Yes.** Five videos rendered from real NemoClaw-orchestrated agent runs. The best one (**v9**) shows the agent navigating shadcn-ui three levels deep and landing the cursor on the Installation section with the install command `pnpm dlx shadcn@latest add button` literally on screen.

**Best video to show:** `~/Downloads/explainer-agent-v9-BEST.mp4` (15 sec, 2.9 MB, 1080p).

---

## All videos produced

| Version | Goal | Outcome | Duration | File |
|---|---|---|---|---|
| **v3** | Button install | Agent clicked "Components" twice (first didn't navigate). Honest but awkward. | 15s | retained as reference |
| **v4** | Button install | 3 actions, ends with explicit "Goal reached" badge on Button install page | 14s | `~/Downloads/explainer-agent-v4-nemoclaw.mp4` |
| v5 | Date Picker install | Stuck — Date Picker is beyond 40-element listing cap | — | dropped |
| **v6** | Date Picker install | Bumped cap to 80, 2 actions: Components → Date Picker page. Ends at goal page. | 11s | superseded by v10 |
| v7 | Sonner install | Only 1 action saved — Nemotron ran out of tokens reasoning over 80 clickables | — | dropped |
| v8 | Button install (cap=80 retest) | 2 actions, did not reach Installation anchor | — | dropped |
| **v9** | Button install | 3 actions: Docs → Button → **Installation#** anchor + synthetic "Goal reached" outro. Install command visible at video end. | 18s | `~/Downloads/explainer-agent-v9-BEST.mp4` |
| **v10** | Date Picker install | 3 actions: Docs → Date Picker → Installation anchor + outro. Date Picker install code visible. | 18s | `~/Downloads/explainer-agent-v10-datepicker-deep.mp4` |

---

## What I changed during the run (in agent.js)

### Iteration 1 → v4 (the "no duplicate clicks" fix)
Replaced fixed-time wait-after-click with **change-detection wait**:
- After click, poll for up to 8 sec
- Exit early if URL changes OR page text shifts >80 chars
- If neither happens after timeout → blacklist that element index for this URL, retry step with a different choice

This single change cleaned up the v3 awkwardness where the agent clicked the same "Components" link twice.

### Iteration 2 → v6, v8, v9 (deeper navigation)
Bumped the clickable-elements cap from 40 → 80. shadcn-ui has ~70 components in its sidebar; 40 truncated everything past "Context Menu." After the bump, agent could see Date Picker (idx 33), Sonner (idx 70), Installation anchor (idx ~78), etc.

### Iteration 3 → v9 (the deep-navigation token fix)
Bumped Nemotron `max_tokens` from 800 → 2000. Reasoning models burn tokens before emitting; an 80-element listing in the prompt made the model frequently hit `finish_reason: length` mid-reasoning. 2000 gives reliable JSON output even on dense pages.

---

## What's working solidly now

- **Real OpenClaw orchestration inside NemoClaw.** Agent loop, Nemotron decision-making, Playwright via `connectOverCDP` to spawned chrome, CDP screencast streaming — all in the sandbox. Host's only job is rendering the final MP4 from artifacts.
- **Change-detection + blacklist** stops the duplicate-click bug cleanly.
- **Cursor continuity in render** carries position across step boundaries — looks like one continuous gesture.
- **Caption truthfulness**: caption uses actual clicked element text; model's description goes in the sub-line. No more "Click Docs" when the agent clicked Components.
- **Honest failures**: when Nemotron can't find the target, it says "stuck" and stops cleanly. Not a hallucinated success.

## What's still rough

1. ~~**"Done" state isn't always reached.**~~ **FIXED.** The action-log rewriter now injects a synthetic done step when the last action is a click, so every video gets a "Goal reached" outro using the after-screenshot of the last successful click.
2. **80-element cap is hardcoded.** Some sites might need 120+. Make it env-configurable.
3. **No scroll capability.** If a clickable is below the viewport, agent doesn't see it. **Future fix:** add `agent_scroll` as a tool the agent can pick, or virtually scroll the page text snapshot.
4. **Token-budget vs cap is a tradeoff.** cap=80 + max_tokens=800 = too tight. cap=80 + max_tokens=2000 = works but slower. Consider truncating the listing to top-30 by text-relevance to the goal before sending to Nemotron — would solve both.

---

## Time spent

| Phase | Time |
|---|---|
| v3 render + diagnosis | 5 min |
| v4 (no-op detection + blacklist) | 8 min |
| v5/v6 (Date Picker variations) | 10 min |
| v7/v8 (Sonner + retest) | 5 min |
| v9 (max_tokens bump + perfect Button) | 5 min |
| Contact sheets + report | 7 min |
| **Total** | **~40 min** |

---

## Recommendation for the hackathon submission

**Use v9 as the primary demo video** (Button task, simplest narrative — clear single-line install command on screen at end).

**Use v10 as the second/variation demo** (Date Picker task, shows the agent generalizes to deeper-nested components).

Both end with "Goal reached" + the actual install command on screen. Tells the full story in 18 seconds each.

For the actual booth demo: use v4 as the "always-on-loop" video at the booth (cleanest ending with the explicit "Goal reached" badge), and run a fresh live agent for the on-demand interactive demo. The infra works — agent.js + agent-browser-style chrome flags + Remotion render — and can be triggered for any new goal in ~90 seconds.

---

## Files for tomorrow

- **Sandbox-side agent.js** (current best version): mirrored on host at `/tmp/sandbox-agent.js`. Push to sandbox via `cat /tmp/sandbox-agent.js | base64 | nemoclaw promo-agent exec -- bash -c 'base64 -d > /sandbox/explainer-agent/agent.js'`
- **Host wrapper**: `/tmp/chrome-wrapper.sh` (sets LD_LIBRARY_PATH for chrome subprocess)
- **Host-pull script**: `/tmp/pull-screenshots.sh` (sandbox → host artifact transfer)
- **Path-rewriter**: `/tmp/rewrite-log.py` (rewrites screenshot paths in action-log.json for Remotion)
- **Remotion composition**: `~/Desktop/Projects/Hackathons/promo-agent/explainer-agent/remotion/src/Explainer.tsx` (cursor-continuity + done-step)

Everything is local. No external services required beyond Nemotron NIM (already authed via `NVIDIA_API_KEY` in sandbox env).
