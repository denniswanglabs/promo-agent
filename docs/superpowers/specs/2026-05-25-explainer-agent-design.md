# Explainer Agent — Design Spec

> **Status:** Feasibility validated end-to-end. Hackathon pivot decision pending (deadline 2026-05-28 12:00, ~58 hr).
>
> **Spec written 2026-05-25 03:00.** Author: Dennis Wang (via Claude Code session).

---

## TL;DR

An autonomous agent that turns "show me how to do X on web app Y" into a finished animated walkthrough video.

Input: a goal + a starting URL.
Output: a 15-30 second produced video with cursor animation, click-ripples, kinetic captions, and a "Goal reached" outro — same Apple-style aesthetic as existing Luceo Studio work.

**Concept proven.** Working sample at `~/Downloads/explainer-agent-demo-v2.mp4` (14 sec, 2.9 MB, shadcn-ui Button install task).

**One real engineering gap remains:** moving the agent runtime from host (where it works) to inside the NemoClaw sandbox (where the hackathon judges it). A specific Chromium launch flag is the known fix; navigation timing still needs ~30 min of debug.

---

## 1. Why this exists

The existing **Promo Agent** for the hackathon takes a company URL → kinetic-typography promo. It works. But the agent's contribution is *invisible* — the output looks like any other promo video. The judges see the artifact, not the loop.

The **Explainer Agent** flips that: the autonomous behavior is *visible in the output itself*. You can see the agent thinking and clicking. Every click is a real choice the model made, and the video preserves that choice as an annotated beat. The agent loop IS the watchable content.

For an autonomous-agent hackathon, that's a much sharper demo.

---

## 2. Architecture (validated)

```
Input: goal + startUrl
   │
   ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Agent loop (driver) — runs in NemoClaw sandbox via OpenClaw skill     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Playwright → Chromium (--enable-features=NetworkServiceIn-     │  │
│  │  Process to survive NemoClaw's AF_NETLINK syscall block)        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  loop {                                                                │
│    1. screenshot before                                                │
│    2. gatherClickables() — accessibility-tree of visible elements      │
│    3. POST Nemotron 3 Super 120B (NVIDIA NIM):                         │
│         goal + URL + title + text snippet + numbered clickables        │
│         → returns {"id": N, "description": ..., "reasoning": ...}      │
│         or {"done": true, "reasoning": ...}                            │
│    4. scrollIntoView({block: 'center'}) the target                     │
│    5. remeasure live coords                                            │
│    6. screenshot before-click (same coords as cursor target)           │
│    7. page.mouse.click(x, y)                                           │
│    8. wait for load + page settle                                      │
│    9. screenshot after                                                 │
│    10. append to action-log.json                                       │
│  }                                                                     │
└────────────────────────────────────────────────────────────────────────┘
   │
   ▼ action-log.json + screenshots/*.png
┌────────────────────────────────────────────────────────────────────────┐
│  Remotion composition (separate, runs on host)                         │
│  - Intro card (goal title, eyebrow, source URL)                        │
│  - For each step:                                                      │
│      • fade in screenshot                                              │
│      • animate cursor from previous click pos → current target         │
│      • lime ring ripple at click point                                 │
│      • caption banner: "Click 'X'" with sub-text reasoning             │
│      • crossfade to after-screenshot                                   │
│  - Done card: "Goal reached" pill                                      │
└────────────────────────────────────────────────────────────────────────┘
   │
   ▼ out.mp4 (1920×1080 @ 30fps, ~3MB per 14s)
```

---

## 3. Components

### 3.1 Agent loop (`agent.js` — sandbox-side)

**State:** working in host mode. **Not yet running in sandbox** due to navigation hang.

**Files:** `/sandbox/explainer-agent/agent.js` (sandbox) + `~/Desktop/Projects/Hackathons/promo-agent/explainer-agent/agent.js` (host mirror).

**Inputs (env):**
- `GOAL` — string. e.g. "Find the installation command for the Button component"
- `START_URL` — string. e.g. "https://ui.shadcn.com"
- `MAX_STEPS` — integer (default 6)
- `NVIDIA_API_KEY` — for Nemotron via NIM
- `HTTPS_PROXY` — for Chromium proxy config (sandbox-set automatically)

**Outputs:**
- `/sandbox/explainer-agent/run/action-log.json` — `{goal, startUrl, viewport, actions[]}`
- `/sandbox/explainer-agent/run/screenshots/step_N_{before,after,final}.png`
- `/sandbox/explainer-agent/observe/latest.jpg` — CDP screencast frame (~5fps for live view)
- `/sandbox/explainer-agent/observe/log.txt` — reasoning trace

**Per-action record shape:**
```json
{
  "step": 1,
  "kind": "click",
  "url": "https://ui.shadcn.com/docs/components",
  "title": "Components - shadcn/ui",
  "target": {"tag": "a", "text": "Button", "aria": "", "href": "/docs/components/radix/button"},
  "click": {"x": 84.98, "y": 454.0, "rect": {"x": 56, "y": 439, "w": 58, "h": 30}},
  "description": "Click Button component link",
  "reasoning": "...",
  "screenshotBefore": "screenshots/step_1_before.png",
  "screenshotAfter": "screenshots/step_1_after.png"
}
```

### 3.2 Remotion composition (`Explainer.tsx` — host-side)

**State:** v2 ships. Cursor continuity validated.

**Files:** `~/Desktop/Projects/Hackathons/promo-agent/explainer-agent/remotion/src/`.

**Constants (ship-locked tonight):**
- 30 fps, 1920×1080
- `INTRO_DURATION = 60` (2 sec)
- `STEP_DURATION = 120` (4 sec per click)
- `DONE_DURATION = 90` (3 sec)
- Cursor spring: `damping: 22, mass: 0.9, stiffness: 90`
- Lime accent: `#84cc16` (matches existing Luceo studio dark/lime palette)

**Continuity rule (validated):** cursor at step N starts at step N-1's click position. First step's cursor enters off-screen from bottom-right. Done step holds the cursor at the final click position, fades it out as the badge appears.

### 3.3 Live observation viewer (host-side, optional)

**State:** scaffolded, not load-bearing for the deliverable.

**Files:** `~/Desktop/Projects/Hackathons/promo-agent/explainer-agent/observe-host/`.

- `poll.sh` — polls `nemoclaw exec -- cat /sandbox/.../latest.jpg` every 500 ms, writes to `public/frame.jpg`
- `public/index.html` — auto-refreshing browser viewer (image + tail of reasoning log)
- Served via `python3 -m http.server 8081`, opened in Safari

Use during development to watch the agent operate in real time. Not part of the produced video pipeline.

---

## 4. The runtime question (the hackathon gate)

The agent loop runs in two known places:

### 4.1 Host-headed mode — **validated tonight**

`HEADED=1 node agent.js` on the Mac. Chromium pops up, you watch it click. Nemotron reasoning streams to terminal. Total run time ~25 sec. Produces clean artifacts.

**Use case:** development, validation, fallback.
**Hackathon weakness:** the agent isn't actually running inside NemoClaw — judges see the right artifact but the wrong runtime story.

### 4.2 In-sandbox mode — **needs ~30 min more debug**

`/sandbox/explainer-agent/agent.js` invoked via OpenClaw skill. Chromium runs inside the sandbox container.

**Status as of 2026-05-25 02:30:**
- ✓ Playwright installed in sandbox
- ✓ Chromium binary present (Playwright bundled)
- ✓ 482 system libs extracted via dpkg-deb (no sudo)
- ✓ Policy presets: `playwright-cdn` + `demo-targets` (shadcn whitelisted)
- ✓ Chromium launches without crashing (NEW: with `--enable-features=NetworkService,NetworkServiceInProcess`)
- ✗ `page.goto('https://ui.shadcn.com')` hangs even with the flag

**Next debug step (tomorrow):** the proxy at `10.200.0.1:3128` is intercepting TLS with a self-signed CA. Even with `--ignore-certificate-errors` and `ignoreHTTPSErrors: true`, the connection negotiation may be stalling. Two specific things to try:
1. Use `waitUntil: 'commit'` instead of `'domcontentloaded'` (returns earlier).
2. Check Chromium stderr (`DEBUG=pw:browser`) for any `ERR_PROXY_CERTIFICATE_INVALID` — if so, install the proxy's CA inside the sandbox's NSS database.

---

## 5. Known-good fixes from tonight (don't re-discover)

| Symptom | Fix |
|---|---|
| Chromium renderer exits 0 on first nav | `--enable-features=NetworkService,NetworkServiceInProcess` |
| `ERR_TUNNEL_CONNECTION_FAILED` on a target URL | Add host to a NemoClaw policy preset under `network_policies.<name>.endpoints` |
| `ERR_CERT_AUTHORITY_INVALID` | Chromium args: `--ignore-certificate-errors` + Playwright: `newContext({ignoreHTTPSErrors: true})` |
| Playwright doesn't pick up `HTTPS_PROXY` | Pass explicitly: `chromium.launch({proxy: {server: process.env.HTTPS_PROXY}})` |
| Click hits empty space on long pages | scrollIntoView({block: 'center'}) the target + re-measure coords before click |
| Nemotron 120B returns no JSON, only reasoning | Bump `max_tokens` to ≥1500. Nemotron 3 Super is a reasoning model — counts thinking against the budget. |
| `nemoclaw exec` rejects multi-line shell args | Write script on host, push via base64 stdin (still limited to 1 MB) |
| Files >1 MB into sandbox | `nemoclaw share mount` (requires macFUSE install) OR chunked base64 |
| Caption disagrees with what the agent clicked | Use `action.target.text` for the caption banner, `action.description` as supporting sub-text |

---

## 6. Open risks

1. **In-sandbox navigation hang.** Time-boxed to 30 min tomorrow. If it doesn't land, host-headed is the fallback (still impressive demo, weaker hackathon narrative).
2. **Nemotron token budget growth.** Heavier pages = more clickables = bigger prompts. May need to truncate clickables list to top-15 by viewport position.
3. **Bot detection / auth on real apps.** v1 demo restricted to public, agent-friendly apps (shadcn, GitHub read-only, Vercel docs). Linear/Notion/Stripe are out of scope.
4. **Caption truthfulness.** Nemotron sometimes invents a verb that doesn't match the clicked element. Mitigation: caption is `Click "<target.text>"` (verbatim); reasoning goes in the sub-text. Already implemented in Remotion v2.
5. **Render time.** Per 14-sec output, ~30 sec to render at concurrency 8 on Apple Silicon. Acceptable for v1.

---

## 7. The hackathon decision

### Option A — Ship URL→promo Agent as currently planned
- Existing 3781-line implementation plan
- ~50 hr remaining build time per the plan
- Sample Trayd MP4 already exists
- Narrative: "URL in → animated promo out, no human in the loop"
- **Risk:** the autonomous-agent angle is invisible in the deliverable

### Option B — Pivot to Explainer Agent
- ~25-30 hr remaining (concept proven, render pipeline mostly there)
- Strongest demo: judges literally watch the agent think and click in the output
- **Risk:** the 58-hour clock + the unresolved in-sandbox navigation hang
- Need to also resolve: which task(s) to ship the demo on (shadcn alone is thin)

### Option C — Submit both, demo Explainer
- URL→promo as the "we shipped what we planned"
- Explainer Agent as the live booth demo
- Highest narrative ceiling
- **Risk:** double the polish workload in the same budget

### Recommendation
**Sleep on it.** The decision hinges on tomorrow's first ~30-min in-sandbox debug session. If `page.goto` works after the `waitUntil` change, Option B becomes clearly best — full pivot. If still flaky, Option A with the Explainer Agent as a "v2 direction" footnote in the submission.

---

## 8. Implementation plan (if Option B)

Rough phases, each independently shippable:

### Phase 1 — Land in-sandbox navigation (2-4 hr)
- Resolve the `page.goto` hang
- Wrap as a one-shot OpenClaw skill (`/sandbox/.openclaw/skills/explainer/SKILL.md`)
- Trigger via dashboard chat with `{goal, startUrl}`
- Action log + screenshots back to `/sandbox/explainer-agent/run/`

### Phase 2 — Render polish (3-5 hr)
- Pick 2-3 demo tasks beyond shadcn (e.g. "how to import a GitHub repo on Vercel", "how to open a new issue on a GitHub repo")
- Multi-task back-to-back composition (intro card → task 1 → transition → task 2 → outro)
- Music + sfx (existing Luceo audio palette)

### Phase 3 — Submission package (4-6 hr)
- Public GitHub repo (`denniswanglabs/explainer-agent`) with policy presets in `agent/presets/`
- QuickTime screencast: 2:30 walkthrough of the dashboard triggering the agent, then the produced MP4
- Update [docs/SUBMISSION.md](../../SUBMISSION.md) with new project name + description
- YouTube upload to Luceo Studio (unlisted) for submission link

### Phase 4 — Booth demo prep (2-3 hr)
- Pre-cache a known-working task + render so booth demo never depends on live network
- 90-second elevator pitch script

**Total remaining if Option B:** ~12-18 hr engineering + ~5-10 hr polish/recording.

---

## 9. What's already validated

- ✅ Cursor-continuity rendered video (v2 MP4 in inbox + Downloads)
- ✅ Host-headed agent run shows cursor + reasoning live
- ✅ Nemotron 3 Super 120B picks reasonable next-click given accessibility tree + goal
- ✅ Chromium installable in sandbox (482 libs, all deps green)
- ✅ Chromium launches in sandbox without crashing (with the magic flag)
- ✅ NemoClaw policy presets for `playwright-cdn` + `demo-targets` (committable)
- ✅ Live-view scaffolding (poll.sh + auto-refreshing webpage)
- ✅ The whole pipeline is concretely understood + scoped

## 10. What's open

- ⏳ In-sandbox navigation hang (~30 min debug)
- ⏳ OpenClaw skill wrapper (~1 hr after Phase 1)
- ⏳ Multi-task render composition (~3 hr)
- ❓ Hackathon pivot decision — depends on the above and Dennis's read in the morning

---

## Appendix A — file locations

| What | Where |
|---|---|
| Working host agent | `~/Desktop/Projects/Hackathons/promo-agent/explainer-agent/agent.js` |
| Sandbox agent (mirrored) | `/sandbox/explainer-agent/agent.js` (inside NemoClaw) |
| Source for sandbox pushes | `/tmp/sandbox-agent.js` (host) |
| Remotion composition | `~/Desktop/Projects/Hackathons/promo-agent/explainer-agent/remotion/src/Explainer.tsx` |
| Policy presets | `~/Desktop/Projects/Hackathons/promo-agent/agent/presets/` |
| v2 demo MP4 | `~/Downloads/explainer-agent-demo-v2.mp4` |
| Live-view scaffolding | `~/Desktop/Projects/Hackathons/promo-agent/explainer-agent/observe-host/` |
| Original Promo Agent (URL→promo) | `~/Desktop/Projects/Hackathons/promo-agent/{agent,docs,sample-run,watchdog}` |

## Appendix B — relevant memory

- `feedback_chromium_in_nemoclaw_netlink` — the launch-flag fix
- `reference_agent_browser_tool` — where we found the fix
- `reference_onecli_credential_broker` — paid alternative we don't need
- `feedback_hackathon_no_substitute_orchestrator` — the rule that gates Option B's narrative validity
