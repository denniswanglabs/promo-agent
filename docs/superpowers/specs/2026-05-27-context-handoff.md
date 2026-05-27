# Context handoff — promo-agent / Explainer Agent

**Written:** 2026-05-27 (post-midnight)
**For:** the next fresh Claude Code chat picking up promo-agent
**Hackathon deadline:** GTC Taipei 2026 — **2026-05-28 12:00 PST (~25 hours)**
**Goal of this doc:** let a fresh session be productive in <5 minutes.

---

## Section 0 — Operating rules (READ FIRST, CRITICAL)

### Hard rules (verbatim from `~/.claude/templates/subagent-brief-stock.md`)

> 1. **NEVER background bash inside subagents.** This means BOTH:
>    - the harness `run_in_background: true` flag, AND
>    - the shell `&` trailing operator (e.g., `command &`, `command > log 2>&1 &`, `nohup command &`).
>    Foreground only. … The orchestrator (not a subagent) is the only place where background commands are legitimate.
>
> 2. **NEVER passively wait for harness notifications.** Subagents can't receive them — there is no `Stop` event delivered back to a subagent. Poll inline with `timeout`-bounded loops or use `wait` for foreground PIDs.
>
>    **Trip-wire phrases.** If you are about to write any of these and end your turn, STOP …
>    - "Waiting on Monitor for …"
>    - "Will update when …"
>    - "The harness will notify …"
>    - "Now in step N (the long-running …). Waiting …"
>    - "Background process started; will report back …"
>
>    **2a. The harness auto-backgrounds your Bash call when it exceeds its `timeout` parameter** (default 120000ms; MAX 600000ms = 10 min). … **This is the silent-death trap.** Inside a subagent that notification will NEVER arrive …
>
>    **2b. The "Monitor as substitute wait" anti-pattern.** After your Bash auto-backgrounds, do NOT load the Monitor tool and arm it to "watch" the backgrounded job. Monitor's notifications also do not reach subagents. … NEVER use Monitor inside a subagent.
>
> 3. **NEVER pass multi-line strings as argv to `nemoclaw promo-agent exec`.** The gRPC layer rejects embedded newlines. Write the prompt to a file first and pass the path, or collapse to a single-line string.
>
> 4. **NEVER chain `&&` between `ls` calls expecting one missing file** — the first failure shorts every subsequent command. Use `;` or test files individually.
>
> 5. **Document state after EACH phase to a `.handoff-X.md` file**, not just at the end.
>
> 6. **Auto-retry 2x then log+skip.** Don't loop indefinitely on a broken subagent or broken external call.
>
> 7. **Bound long operations with `timeout`.** Bash tool `timeout` parameter MAX is 600000ms (10 min) — anything longer auto-backgrounds. For operations that legitimately need > 10 min wall-clock, CHUNK into < 600s phases with `.handoff-<phase>.md` checkpoints between Bash calls.
>
> 8. **If a destructive op is on your path, STOP and surface to the orchestrator.** This includes `nemoclaw … destroy`, `rm -rf`, `pkill` of any process the subagent didn't spawn, `git reset --hard`, `git push --force`.

### Project-specific rules (from same template)

- **Chrome flags:** launch Chromium with `--enable-features=NetworkService,NetworkServiceInProcess --ignore-certificate-errors`.
- **Video projects:** render with `--concurrency=8`; verify via tiled stills before full MP4.
- **Vertical 9:16 video:** reserve top 12% for iPhone notch (`TOP_SAFE_PX`).

### Plus — orchestrator-level rules for THIS session

- **One short plan-sentence per turn, then tool call.** Don't end on planning text.
- **Don't read files >300 lines fully.** `grep -n` first; targeted `Read` second.
- **Foreground only**, no `&`, no Monitor inside subagent.
- **Don't write trip-wire phrases** ("Now I'll…", "Continuing.", "Let me…:").

### Memory files the fresh session MUST read up-front

These exist at `~/.claude/projects/-Users-dennis/memory/`:

- `feedback_canonical_explainer_agent_video_format.md` — **out-231556 is canon**; future renders must match its pipeline (full canonical, not the slideshow/wallpaper experiments)
- `feedback_no_premature_ship_off_ramp.md` — don't pitch shipping prematurely; finish the work first
- `feedback_aggressive_delegation.md` — delegate to subagents by default; chat stays high-level
- `feedback_subagent_bash_timeout.md` — Bash MAX 600000ms; chunk longer ops with `.handoff-X.md`
- `feedback_subagent_postmortem.md` — every premature subagent exit triggers a forensic post-mortem subagent that patches LESSONS.md / template / a new feedback file
- `feedback_chromium_in_nemoclaw_netlink.md` — Chrome MUST launch with `--enable-features=NetworkService,NetworkServiceInProcess --ignore-certificate-errors` to survive NemoClaw's AF_NETLINK syscall block + proxy MITM
- `feedback_zshenv_for_api_keys.md` — `source ~/.zshrc 2>/dev/null` before any Bash that needs `NVIDIA_API_KEY` (keys live in `.zshrc` on this machine, verified 2026-05-15)

---

## Section 1 — What was built tonight (architecture lineage)

The Explainer Agent for GTC Taipei 2026 is a two-pass system: NemoClaw sandbox runs the agent, host machine performs the cinematic replay + AutoOverlay render.

### Sandbox baseline

- **Custom Dockerfile** baking Chromium runtime deps into the NemoClaw sandbox lives at `/tmp/promo-agent-build/Dockerfile`.
- **`nemoclaw onboard --from /tmp/promo-agent-build/Dockerfile` is the only way to restore the sandbox.** Plain `nemoclaw promo-agent rebuild` strips chrome libs back to the default image.

### BEAM=0 mode is canonical

- **BEAM=0 + judge-disabled is what produces clean MP4s.** Commit `efe9b18` (v36) bypasses the judge with a synthetic verdict in the BEAM=0 path. The BEAM=1 judge-rollback mode is broken (Nano-Omni ignores the brevity constraint, kills usable runs).
- `tutorial-maker.sh` defaults to BEAM=1. **Always export `BEAM=0` explicitly.**

### Prompt + plumbing evolution in `agent.sandbox-v26.js`

| Commit | Version | Change |
|---|---|---|
| `ce18a3e` | v29 | Judge `max_tokens` 4000 → 6000 |
| `61dba1c` | v30 | Judge brevity constraint added (Nano-Omni ignored it) |
| `b6d2343` | v31 | Keyword-anchor in both judge and proposer prompts |
| `0cf3889` | v32 | Hard keyword override + JSON-first output |
| `5435fb0` | v33 | Surface full Nemotron / Omni thinking to `agent.log` |
| `4abbd0d` | v34 | Chrome launch flag `--enable-features=NetworkService,NetworkServiceInProcess` |
| `efe9b18` | v36 | **Judge disabled in BEAM=0 mode** (synthetic verdict) — canonical |

`agent.sandbox-v26.js` is now at HEAD = `f80d45f` (clean revert per Dennis's request).

---

## Section 2 — Successful renders (artifacts on disk)

| File | Size | Duration | What |
|---|---|---|---|
| `~/Downloads/explainer-pitch-75s-bgm.mp4` | 12 MB | 74.6s | Pitch video |
| `~/Downloads/explainer-submission-v11-stripe-cinematic-v3-fixed-v2.mp4` | 12 MB | 25.9s | "Peak" Stripe demo |
| `~/Desktop/.../explainer-agent/out-231556-*.mp4` | 4.4 MB | ~32s | **Canonical reference** (Stripe v17 → `/account/set-up`) |
| `~/Downloads/stripe-experiment-v17.mp4` | 17 MB | 40.7s | v17 with CameraZoom + Wallpaper |
| `~/Downloads/stripe-experiment-v18.mp4` | 11 MB | ~32s | Stripe v18 → `/billing/billing-apis` |
| `~/Downloads/yc-jared-v8.mp4` | 70 MB | ~50s | YC v8 with 13 noisy actions |
| `~/Downloads/yc-jared-v8-filtered.mp4` | 9.3 MB | 23.3s | YC v8 filtered to productive subset (option A filter) |
| `~/Downloads/yc-jared-v8-slideshow.mp4` | 2.3 MB | 13.5s | Screenshot slideshow comp test — **REJECTED, not canonical** |
| `~/Downloads/stripe-experiment-v17-static-wallpaper.mp4` | 7.4 MB | 40.7s | Static framing + wallpaper test — **REJECTED** |
| `~/Downloads/stripe-experiment-v17-wallpaper-bg.mp4` | 6.2 MB | ~32s | colorkey-bg test — **REJECTED** |
| `~/Downloads/stripe-v17-layered.mp4` | 5.1 MB | ~32s | ffmpeg PIP wallpaper test — **REJECTED** |

**Canonical reference Dennis confirmed:** `out-231556-*.mp4`. Future renders use the FULL canonical pipeline (NOT slideshow, NOT wallpaper bg, NOT static-framing experiments).

---

## Section 3 — Pipeline diagram (text-based)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1 — Allowlist build (host)                                        │
│  ─────────────────────────────                                          │
│  Per-domain allowlist of selectors / actions for the start URL.         │
│  Output: allowlist JSON consumed by the sandbox agent.                  │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 2 — Agent in NemoClaw sandbox                                     │
│  ──────────────────────────────────                                     │
│  Sandbox: `promo-agent` (NemoClaw)                                      │
│  Entry:   /sandbox/explainer-agent/agent.sandbox-v26.js                 │
│  Browser: Playwright Chromium (1148 -> 1223 via symlink)                │
│           launched with                                                  │
│           --enable-features=NetworkService,NetworkServiceInProcess       │
│           --ignore-certificate-errors                                    │
│                                                                          │
│  Proposer model: Nemotron-3-Super-120B (NIM, OneCLI broker)             │
│  Judge model:    Nano-Omni — DISABLED in BEAM=0 (synthetic verdict)     │
│                                                                          │
│  BEAM=0  → proposer-only, judge bypassed, canonical clean output        │
│  BEAM=1  → judge rollback enabled, currently broken (do not use)        │
│                                                                          │
│  Per-step output: screenshot.png + step.json + thinking trace          │
│  Final output:    run.json (the action sequence + per-step metadata)    │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 3 — Cinematic replay at 60 fps (host)                             │
│  ─────────────────────────────────────────                              │
│  Replays run.json on host Playwright at 60fps with cinematic camera     │
│  moves (zooms, pans). Captures frame sequence for Remotion.             │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 4 — Remotion AutoOverlay render                                   │
│  ────────────────────────────────────                                   │
│  Comp: remotion/src/AutoOverlay.tsx (HEAD, clean)                       │
│  Adds: title card, captions, action callouts, brand chrome              │
│  Render: --concurrency=8 → MP4 in ~/Downloads/                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Section 4 — Hackathon submission spec

**Event:** GTC Taipei 2026
**Deadline:** 2026-05-28 12:00 PST (~25 hours from this writeup)

### Submission video format

- **3-5 minutes total**
- Recorded with **Loom / Zoom / Teams + camera ON**
- Required structure:

| Slot | Duration | Content |
|---|---|---|
| 1 | 20-30s | Team intro |
| 2 | 30-40s | Elevator pitch |
| 3 | **45-60s** | **Live demo (our agent-demo MP4s embed HERE)** |
| 4 | 60-90s | Tech deep-dive (architecture, models, optimizations) |
| 5 | 20-30s | "So what" — impact / why it matters |

- **File name = app name**

### Where our MP4s plug in

The 45-60s "live demo" slot is filled by an embedded agent-demo MP4. Leading candidates:

- **`stripe-experiment-v18.mp4`** — cleanest, 11 MB, ~32s, 3 clicks → fits the demo slot tightly
- **`out-231556-*.mp4`** — the canonical reference Dennis confirmed

Dennis records intro / pitch / tech / impact slots separately around the embedded demo.

---

## Section 5 — Dirty working tree state (uncommitted)

Project: `~/Desktop/Projects/Hackathons/promo-agent/`

| File | State | Notes |
|---|---|---|
| `agent.sandbox-v26.js` | HEAD `f80d45f` — clean | Reverted per Dennis's request |
| `remotion/src/AutoOverlay.tsx` | HEAD — clean | Restored |
| `remotion/src/ScreenshotSlideshow.tsx` | **NEW, 495 lines, uncommitted** | Slideshow comp test — Dennis REJECTED this style. Can be deleted, or kept as future-reference fork. |
| `remotion/src/Root.tsx` | uncommitted | Has `ScreenshotSlideshow` Composition registration. Commit if keeping the comp, revert if deleting. |
| local vs `origin/main` | **32+ commits ahead** | Not yet pushed |

---

## Section 6 — Open decisions / next-session priorities

1. **Decide on ScreenshotSlideshow.tsx:** commit + keep as a future optimization path, or delete + revert `Root.tsx` to remove the registration.
2. **Push the 32+ commits to GitHub** — Dennis-only action (don't push without explicit ask).
3. **Upload `explainer-pitch-75s-bgm.mp4` to Luceo Studio YouTube channel.**
   - Channel-binding gotcha: `youtube-upload` posts to the *active* channel.
   - `denniswanglabs@gmail.com` defaults to **Dennis Engineering**, not Luceo Studio.
   - **Switch active channel to Luceo Studio FIRST, then re-auth `youtube-upload`** before invoking.
4. **Confirm GTC submission form URL** — not captured in any project doc yet. Dennis needs to surface it.
5. **Record the live walkthrough video (3-5 min)** per the submission-spec structure above.
6. **Pick the demo MP4 to embed** in the 45-60s slot. Leading candidates: `stripe-experiment-v18.mp4` (11 MB, ~32s, cleanest) or `out-231556-*.mp4` (canonical reference).

---

## Section 7 — Quick-start commands for fresh session

### Fire a new agent-tutorial video

```bash
source ~/.zshrc && BEAM=0 bash ~/Desktop/Projects/Hackathons/promo-agent/tutorial-maker.sh \
  "<START_URL>" \
  "<GOAL>" \
  "~/Downloads/<NAME>.mp4"
```

### If the sandbox is broken / wiped, rebuild

```bash
# Use the custom Dockerfile (NOT `nemoclaw rebuild` — strips chrome libs).
nemoclaw promo-agent destroy --force --yes
nemoclaw onboard --from /tmp/promo-agent-build/Dockerfile \
  --name promo-agent --non-interactive --yes
# Then re-push agent.js + run.sh + package.json into the sandbox,
# re-install npm deps + Playwright Chromium.
# (See prior session's onboard subagent for the exact step sequence.)
```

### Sanity-check sandbox state

```bash
nemoclaw promo-agent status
nemoclaw promo-agent exec --no-tty -- ls /sandbox/explainer-agent/
nemoclaw promo-agent exec --no-tty -- \
  /tmp/.cache/ms-playwright/chromium-1223/chrome-linux/chrome --version
```

---

## Section 8 — Critical session lessons (gotchas)

- **`nemoclaw rebuild` does NOT preserve chrome libs.** It strips back to the default image. Use `nemoclaw onboard --from /tmp/promo-agent-build/Dockerfile` instead.
- **`nemoclaw onboard` requires `NVIDIA_API_KEY` in env.** Always `source ~/.zshrc` first.
- **Chromium path mismatch.** `agent.js` hardcodes `chromium-1148`; Playwright installs `chromium-1223`. Symlink required:
  ```bash
  ln -sfn /tmp/.cache/ms-playwright/chromium-1223 /tmp/.cache/ms-playwright/chromium-1148
  ```
- **`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`** is required for `npx playwright install` inside the NemoClaw sandbox.
- **Sandbox runs as `sandbox` user with no sudo.** Can't `apt-get install` — bake deps into the Dockerfile instead.
- **pthread `RLIMIT_NPROC=512` is hardcoded in NemoClaw.** Processes accumulate across runs. Rebuild via `destroy` + `onboard` every 3-5 runs to keep clean.
- **`BEAM=0` env override MUST be set explicitly** or `tutorial-maker.sh` defaults to `BEAM=1` (the broken judge-rollback mode).
- **Per `feedback_subagent_bash_timeout`:** Bash MAX is 600000ms (10 min). Chunk longer operations with `.handoff-X.md` checkpoints.
- **Per `feedback_video_intake_branching`:** brainstorming-style clarifying questions ARE appropriate when intent is unclear (intake phase only). Otherwise execute without asking.
- **Chrome launch flags are non-negotiable** in the sandbox: `--enable-features=NetworkService,NetworkServiceInProcess --ignore-certificate-errors`. Without them, Chromium dies on AF_NETLINK / cert errors from the OneCLI proxy MITM.

---

**End of handoff.** A fresh Claude Code chat reading this top-to-bottom should be unblocked in <5 minutes and able to drive the GTC submission to finish.
