# Demo Screencast — Storyboard & Recording Notes

**Target length: 2:00-2:30.** Submitted as YouTube unlisted via Luceo Studio channel ([feedback_youtube_channel_binding](https://github.com/luceo-studio) — switch active channel before upload).

**Recording tool:** QuickTime → File → New Screen Recording. Audio: built-in mic. Resolution: 1920×1080.

## Pre-recording setup checklist

```bash
# 1. Clean sandbox state
nemoclaw promo-agent exec -- rm -f /sandbox/out.mp4 /sandbox/render.status /sandbox/render.log

# 2. Confirm policy presets are applied
nemoclaw promo-agent policy-list | head -20

# 3. Pre-warm Remotion node_modules (avoids first-run npm install during demo)
nemoclaw promo-agent exec -- bash -c 'cd /sandbox/promo-render && ls node_modules/remotion >/dev/null && echo "warm" || npm install --silent'

# 4. Open dashboard for the optional stretch shot
open -a Safari "$(nemoclaw promo-agent dashboard-url --quiet)"

# 5. Open the policy file in your editor (Sublime/VS Code) — needed for the bonus shot
open -a "Visual Studio Code" ~/Desktop/Projects/Hackathons/promo-agent/agent/policy.yaml

# 6. Make sure NVIDIA_API_KEY is loaded in your terminal (host)
echo "Key length: ${#NVIDIA_API_KEY}" # should be ~70
```

## Storyboard (2:15 target)

### Cold open (0:00–0:10)
**Visual:** terminal centered, full-screen.
**You say (voice or text overlay):**
> "Making promo videos manually takes me eight hours each. Can an autonomous agent do it in two minutes?"

### Setup (0:10–0:25)
**Visual:** type the command live (or pre-record + time-lapse):
```
nemoclaw promo-agent exec -- bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh https://benchling.com /sandbox/out.mp4
```
**You say:**
> "One shell command. The agent fetches the brand, calls Nemotron 3 Super 120B for the composition, and renders a kinetic-typography promo via Remotion. All inside the NemoClaw sandbox."

### Run-through (0:25–1:10)
**Visual:** the terminal output as the script runs. Speed it up 2× if it takes more than 45 sec.
**Overlay text appearing as steps happen:**
- 0:30 — "[1/5] fetch brand" — show the script's output line
- 0:38 — "[2/5] Nemotron → composition" — show the spec.json contents preview (5 scenes, palette extracted)
- 0:50 — "[3/5] Remotion project written"
- 0:55 — "[4/5] rendering 900 frames" — show progress bar
- 1:08 — "[5/5] DONE: 3.9M"

### Reveal (1:10–1:50)
**Visual:** play the resulting MP4 inline (it's only 30 sec, but the demo can fast-forward through the middle and let the CTA scene land).
**You say:**
> "Real palette pulled from the site, real customer quote from the page, no fabricated stats. Cost: zero. Time: ninety seconds."

### NemoClaw guardrails (1:50–2:15)
**Visual:** cut to your editor showing `agent/policy.yaml`. Highlight these lines (zoom in or arrow them):
- `max_llm_calls_per_task: 25`
- `tools_whitelist:` (the 6 tools)
- `outbound_default: deny`

**You say:**
> "The agent runs under NemoClaw's policy file. It can't make more than 25 Nemotron calls per task. It can't reach any domain outside this allowlist. When we first ran this build, the agent tried to download from Higgsfield's CDN and the proxy returned 403 — until we added the host to the policy. That's the bonus criterion the hackathon asks for: working policy-based guardrails, not a theoretical wrapper."

### Close (2:15)
**Visual:** GitHub URL + submission tagline
> "github.com/denniswanglabs/promo-agent — NVIDIA GTC Taipei 2026."

## Stretch (optional second take)

If the first take feels short, add a 20-second second shot showing the dashboard autonomous path:
- Type "Make a promo for kolr.ai" in the dashboard
- Cut to "agent fires openclaw:core:exec"
- Cut to "MP4 produced"

Caveat: this path is flaky on Nemotron 120B. If it works in one take, ship. If it doesn't, the CLI shot is the demo.

## Post-recording

```bash
# Trim with QuickTime (Cmd+T) to ≤2:30
# Export → 1080p

# Upload (use the youtube-upload skill, ensure Luceo Studio is the active channel)
~/.claude/skills/youtube-upload/youtube-upload.py \
  --title "Promo Agent — NVIDIA GTC Taipei 2026 Hackathon" \
  --description "$(cat docs/SUBMISSION_DESCRIPTION.md)" \
  --visibility unlisted \
  ./demo.mp4
```

(`SUBMISSION_DESCRIPTION.md` is in this repo at `docs/SUBMISSION.md`.)
