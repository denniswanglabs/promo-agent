# Explainer Agent — Context Handoff v4

**Written:** 2026-05-26 ~17:30 PST (day 2 afternoon; ~6h after v3)
**Audience:** A fresh Claude Code session resuming this work as the orchestrator.
**Goal:** Productive in 5 minutes — but ONLY after Section 0.
**Hackathon deadline:** 2026-05-28 12:00 (~19h from this handoff).

Read v3 first for context-prior; this v4 is the **day-2 afternoon delta** + a hardened
operating-rules preamble. v3 mentioned the operating rules but they got missed. v4
makes them impossible to miss.

---

## 0. OPERATING RULES — READ FIRST

**Do not dispatch a single subagent until you have internalized all 7 rules below.**
These are not suggestions. v3 buried them; v4 leads with them. Every premature exit
and silent death in the last session traces to violating one of these.

### 0.1 AGGRESSIVE SUBAGENT DELEGATION — every task goes to a subagent, no exceptions.

Even "fast" tasks (single ffmpeg call, git commit, file edit). Reason: tokens are not
a constraint; **the orchestrator chat surface staying live for Dennis IS the deliverable.**
Reinforced 5 times in the previous session. The orchestrator only orchestrates — it
does not type bash itself when a subagent could.
See `~/.claude/projects/-Users-dennis/memory/feedback_aggressive_delegation.md`.

### 0.2 NEVER BACKGROUND BASH INSIDE SUBAGENTS.

Neither `run_in_background: true` (the harness flag) NOR shell `&` trailing.
**Foreground only.** Wrap with `perl -e 'alarm N; exec @ARGV' -- <cmd>` to bound
runtime — perl alarm BLOCKS the subagent's turn until the command exits, which is
exactly what we want.

Previous session had multiple subagent deaths from `... &` orphaning host processes
(YC tutorial-maker, poll-scouts). The subagent's turn ends before the `&` job has
done anything, and the orchestrator never gets a status. See
`~/.claude/templates/subagent-brief-stock.md` rule 1.

### 0.3 NEVER WRITE TRIP-WIRE PHRASES AND END YOUR TURN.

Banned phrases inside subagents:
- "Waiting on Monitor..."
- "Will report back..."
- "Background process started; will update..."
- Any "I'll check back in N minutes"

**Subagents cannot receive harness notifications.** Ending the turn while "waiting"
is silent death. If you must wait for a long command, foreground-wait inside `perl
alarm` or surface "this is long-running; orchestrator should dispatch a Bash
run_in_background watcher" and exit cleanly with the command not started.

### 0.4 WATCHDOG MUST BE RUNNING WHENEVER 1+ SUBAGENT IS IN FLIGHT.

Threshold is **1+ in-flight**, not 2+. Start Monitor on the watchdog script at the
start of the session:

```
Monitor tool:
  command="/Users/dennis/.claude/scratch/watchdog-2026-05-26-session.sh"
  description="Subagent watchdog — flags stuck >180s no growth"
  persistent=true
  timeout_ms=3600000
```

The script polls every 30s, emits stuck flags (180s no output growth), 15-min status
reports, 20-min heartbeats. Threshold 5min terminated + bash 3.2 suppression fix
already applied.

**Known meta-bug:** the watchdog self-flags as stuck (its own .output file isn't
growing). **Benign — ignore.** Previous session task id: `bchwhhpta`.

See `~/.claude/projects/-Users-dennis/memory/feedback_subagent_watchdog.md`.

### 0.5 EVERY PREMATURE SUBAGENT EXIT → POST-MORTEM SUBAGENT.

Signals of premature exit:
- `"completed"` status + mid-action final message ("Now move X", "Continuing.", ends with a colon)
- Final message in present-progressive without follow-up
- Subagent ends after writing a plan but before executing it

**Don't just redispatch the work.** Dispatch a forensic subagent that root-causes the
exit + patches the brief template / LESSONS.md so the pattern doesn't recur. The
post-mortem is part of the self-improving loop.
See `~/.claude/projects/-Users-dennis/memory/feedback_subagent_postmortem.md`.

### 0.6 DON'T READ FULL SOURCE FILES IN SUBAGENT BRIEFS.

`AutoOverlay.tsx` is **1672 lines**. Full-file reads caused **4 premature exits**
in the previous session — the subagent burns its context on the read and dies before
acting. Use `grep -n` first, then 20-30 line targeted `Read` calls with offsets.

### 0.7 SPEND MONEY FREELY.

Dennis's exact words: **"I value time more than tokens."** No need to ask before paid
NIM runs unless the cost is unusually high (>$5/attempt). The YC tutorial run cost
~$1-2 per attempt and Dennis authorized "spend as much as needed."

---

**If you violated any of these in your first 3 dispatches, STOP and re-read.**

---

## 1. One-line resume

```bash
cat ~/Desktop/Projects/Hackathons/promo-agent/docs/superpowers/specs/2026-05-26-context-handoff-v4.md
git -C ~/Desktop/Projects/Hackathons/promo-agent log --oneline -25
ls -lt ~/Downloads/explainer-* ~/Downloads/yc-* 2>/dev/null | head -10
```

---

## 2. What shipped (cinematic work) this afternoon

### Polished cinematic — the day-2-afternoon flagship

- **`~/Downloads/explainer-submission-v11-stripe-cinematic-v3-fixed-v3.mp4`**
  - 25.83s, 2560×1440 @ 60fps, 12.18 MB
  - Whole-comp CameraZoom + Big Sur macOS Sonoma wallpaper + UV overlay re-anchor + edge-snap clamp
  - Commits: `b40173c`, `c657fc8`, `bdfc178`, `2533d8a`, `0708bae`, `f80d45f`

### 75-second pitch with BGM

- **`~/Downloads/explainer-pitch-75s-bgm.mp4`** — 74.55s, L5 tappay BGM at 0.85 solo level

### Submission package (local commit only, not pushed)

- Commit `9c3b62c` — README rewrite + SUBMISSION + HACKATHON-SUBMISSION-DRAFT + docs/architecture.svg

---

## 3. Infrastructure stood up today

- **Dashboard `:8082`** — Flask sidecar at `explainer-agent/observe-host/dashboard/`. Form for URL+goal → spawns `tutorial-maker.sh` → live progress page → MP4 download. Removes Claude from the live-demo path. Start: `bash explainer-agent/observe-host/dashboard/launch.sh`. **PID 54649 may already be running** — check before re-launching.

- **Grid `:8081/grid.html`** — multi-scout dashboard. NEW right-side event panel (commit `d78bc31`) + NEW raw-log tab toggle (commit `f997842`). Backed by `gen-manifest.sh` (writes `events.jsonl` from `log.txt`) + `poll-scouts.sh` (mirrors `/sandbox/.../scout-frames/r*_s*/f*.jpg` to host).

- **`poll-scouts.sh` patched at commit `e10feb5`** — collapsed multi-line `bash -c` to single-line because nemoclaw CLI rejects newlines in exec argv. Fresh daemon running (orchestrator background bash).

- **`gen-manifest.sh` fresh restart** — old PID 34084 was running 4-hour-old code without the events.jsonl writer. Orchestrator restarted it via Bash `run_in_background`.

- **Self-improving trail-analyzer** — LaunchAgent `com.dennis.self-improvement-analyzer` runs hourly, writes to `~/.claude/scratch/self-improvement-suggestions.md`.

- **Watchdog Monitor** — task `bchwhhpta` (5min terminated threshold + bash 3.2 suppression fix). Restart in fresh session per Section 0.4 above.

---

## 4. Bugs found + fixed today (chronological)

| # | Bug | Commit |
|---|---|---|
| 1 | Two-cursor bug — replay-60fps.js duplicating base cursor | `4df5889` |
| 2 | cameraEvents schema gaps (added targetCenter UV + targetZoom) | `42db80e` |
| 3 | AutoOverlay structural rebuild (Stage / FramedScreen / VideoCrop / CameraZoom) | `65fc32f`, `b40173c` |
| 4 | Big Sur classic gradient wallpaper | `2533d8a`, `fb028b0`, `c657fc8` |
| 5 | Lone zoom factor wrong | `a17e44a`, `bdfc178` |
| 6 | v3 base mp4 was Wikipedia not Stripe → swapped via subagent | no commit |
| 7 | Overlay re-anchor (SourceCoordScaler) | `0708bae` |
| 8 | Wallpaper edges sliding off canvas (150% oversize + edge-snap clamp) | `f80d45f` |
| 9 | BEAM=4 → BEAM=1 + BEAM_K=4 semantic fix | `86e2d21` |
| 10 | Post-nav 2.5s settle for full UI render | `4d9e548` |
| 11 | K=4 winner-screencast re-attach default-context teardown | `ac2efcf` |
| 12 | K=4 newPage burst staggering | `fdc57cf` |
| 13 | Drop K=4 → K=2 to fit sandbox 512 nproc cap | `3e0b4b1` |
| 14 | Brief template + LESSONS.md sharpened to forbid shell `&` | template-only |
| 15 | NemoClaw ulimit raise 512→2048 attempt → NO-OP (binary hardcodes) | docs only |

Bug 15 is documented at `.nemoclaw-ulimit-patch.md` — the ulimit edit at
`~/.nemoclaw/source/scripts/nemoclaw-start.sh` does nothing because the binary
ignores the script's ulimit settings. Don't retry that path.

---

## 5. Outstanding bug under investigation

**Chromium blank-screenshot bug.** Subagent `a07dc526d9cf7ca86` was investigating
this at handoff time.

Symptoms during the K=2 YC tutorial run:
- Agent sees "completely blank with no visible content" on every page snapshot
- `0 clickables` reported
- Loops between `/library` and `/companies`, never executes any action
- No mp4 emitted

Hypothesis space documented in the subagent's brief. **Check
`/tmp/...a07dc526d9cf7ca86.output` for results when the fresh session starts.**
If the subagent died prematurely, dispatch a post-mortem per rule 0.5.

---

## 6. Pending decisions for Dennis

| What | Notes |
|---|---|
| Push the 22+ local commits to GitHub | Dennis controls `git push` |
| YouTube upload of `explainer-pitch-75s-bgm.mp4` | Luceo Studio channel — switch active channel per `feedback_youtube_channel_binding` before upload |
| Hackathon form submission | Use `.submission-content-draft.md` (already drafted by subagent) |
| Re-attempt YC video after Chromium bug fix | Dennis authorized "spend as much as needed"; ~$1-2 NIM per attempt |
| Cleanup of 100+ untracked dirty files | In working tree; defer until after submission lands |

---

## 7. Key file paths

| Type | Path |
|---|---|
| Spec | `docs/superpowers/specs/2026-05-26-cinematic-uv-crop-design.md` (commit `76a737b` → `2533d8a`) |
| Plan | `docs/superpowers/plans/2026-05-26-cinematic-uv-crop-plan.md` (commit `c9f6707`) |
| v3 handoff | `docs/superpowers/specs/2026-05-26-context-handoff-v3.md` |
| Submission drafts | `.submission-content-draft.md`, `.booth-demo-plan.md`, `.public-dir-audit.md`, `.test-website-candidates.md`, `.nemoclaw-ulimit-patch.md` |
| Watchdog script | `~/.claude/scratch/watchdog-2026-05-26-session.sh` |
| Brief template | `~/.claude/templates/subagent-brief-stock.md` |
| Memory feedbacks | `~/.claude/projects/-Users-dennis/memory/feedback_*.md` |
| LESSONS log | `~/.claude/projects/-Users-dennis/LESSONS.md` |

---

## 8. Open subagents at handoff time

- **`a07dc526d9cf7ca86`** — Chromium blank-screenshot investigation. Check the
  `.output` file for findings. If it died prematurely, dispatch a post-mortem
  subagent per rule 0.5 (not just a redispatch).

No other subagents in flight. Watchdog should resume per rule 0.4.

---

## 9. Fastest path to shipping (suggested order)

Given ~19h to deadline:

1. **Re-read Section 0.** Internalize before touching anything.
2. **Start the watchdog** before any subagent dispatch.
3. **Check `a07dc526d9cf7ca86` output** — decide whether the Chromium bug is
   investigatable in the remaining time, or whether to ship without the YC demo.
4. **If shipping now:** push the 22 local commits + upload `explainer-pitch-75s-bgm.mp4`
   to YouTube + fill the hackathon form using `.submission-content-draft.md`.
5. **If retrying YC:** dispatch a single subagent to read the Chromium investigation
   findings + propose a fix + run one K=1 attempt with the fix applied. ~$1-2 NIM.

---

## 10. Dennis's working style (afternoon reinforcements)

- **"Include the watchdog and subagent rule very clearly. last time it didn't catch it."** — direct quote at v4 handoff time. v4 lifts the rules to Section 0 for this reason.
- **"I value time more than tokens."** — no budget limit on tokens or NIM API.
- **Aggressive delegation by default** — every task to a subagent, no orchestrator typing.
- **Watchdog at 1+ in-flight** (the previous "2+" threshold was too loose).
- **Post-mortem every premature exit** — feeds the self-improving loop.

---

**End of handoff v4.** If git log shows newer commits than this file references,
trust git. If anything contradicts this file, trust the live state on disk. If you
catch yourself about to violate a Section 0 rule, STOP and re-read.
