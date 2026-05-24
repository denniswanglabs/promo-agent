# Promo Agent

> Autonomous agent that turns a company URL into an animated promo video. Powered by **Nemotron 3 Super 120B** running inside **NemoClaw**, with policy-based guardrails enforcing scope, budget, and content discipline. No human in the loop after the URL.

**Submission for NVIDIA GTC Taipei 2026 Hackathon.**

**Live demo:** [promo-agent-kappa.vercel.app](https://promo-agent-kappa.vercel.app) — interactive gallery of nine real-brand renders, 27-second sizzle reel, architecture diagram, and NemoClaw policy walk-through.

---

## What it does

Give it a company URL. Get back a 30-second kinetic-typography promo video.

```
You:    "Make a promo for https://benchling.com"
Agent:  [fetches the brand, composes scenes, renders 900 frames]
Out:    /sandbox/out.mp4   (3-7 MB, 30 sec @ 1920×1080)
        Total time: ~90 sec.   Cost: $0.
```

The agent does every step end-to-end:
1. **Research** the brand (palette, fonts, hero copy, customer quotes) via `fetch_brand.py`
2. **Compose** a 5-scene `CompositionSpec` via a direct Nemotron call
3. **Render** kinetic typography per-scene via Remotion (no image/video assets, $0 to generate)

The MP4 is produced inside the NemoClaw secure sandbox. Network calls, file writes, and resource limits are all enforced by a declarative policy file ([`agent/policy.yaml`](agent/policy.yaml)) — that's the bonus-criterion deliverable.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  User (dashboard chat OR CLI)                                    │
│  "Make a promo for https://kolr.ai"                              │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  NemoClaw sandbox (Docker, policy-gated)                         │
│                                                                  │
│   OpenClaw agent runtime                                         │
│      │                                                           │
│      └─► openclaw:core:exec                                      │
│            │                                                     │
│            ▼                                                     │
│         make_promo.sh <URL>                                      │
│            │                                                     │
│            ├─► fetch_brand.py  ──── HTTPS GET (brand-fetch)      │
│            ├─► Nemotron API     ──── HTTPS POST (nemotron-direct)│
│            ├─► write_remotion_project.py                         │
│            └─► npx remotion render ── Chromium headless          │
│                                                                  │
│   Output: /sandbox/out.mp4                                       │
└──────────────────────────────────────────────────────────────────┘

Policy: agent/policy.yaml — caps tool surface, network allowlist, binary whitelist.
Custom policy presets at agent/presets/ — applied via `nemoclaw promo-agent policy-add`.
```

## NVIDIA AI ecosystem used

- **Nemotron 3 Super 120B** (`nvidia/nemotron-3-super-120b-a12b`) via NVIDIA NIM at `build.nvidia.com` — composition planner
- **NemoClaw v0.0.50** — secured agent runtime (the ⭐ bonus-criterion stack)
- **OpenClaw v2026.5.18** — agent framework inside NemoClaw

## Quick start

### Prerequisites

- macOS or Linux (arm64 or x86_64)
- Docker Desktop (≥16 GB memory allocated)
- Node 22.16+ and npm 10+
- Python 3.11+
- `jq`
- NVIDIA API key from [build.nvidia.com](https://build.nvidia.com)
- Higgsfield credits *(optional, only for `--mode=asset` path — kinetic mode needs no Higgsfield)*

### Install

```bash
# 1. Install NemoClaw (interactive — pick NVIDIA Endpoints + Nemotron 3 Super 120B)
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash

# 2. Clone this repo
git clone https://github.com/<YOUR-USER>/promo-agent.git
cd promo-agent

# 3. Apply our policy presets to the running sandbox
for f in agent/presets/*.yaml; do
  nemoclaw promo-agent policy-add --from-file "$f" --yes
done

# 4. Install Chrome libs in the sandbox (one-time, no sudo needed)
nemoclaw promo-agent exec -- bash -c '
  cd /tmp && mkdir -p chrome-libs && cd chrome-libs &&
  curl -sL "https://deb.debian.org/debian/dists/trixie/main/binary-arm64/Packages.gz" -o /tmp/Packages.gz &&
  gunzip -f /tmp/Packages.gz &&
  for pkg in libnspr4 libnss3; do
    FN=$(awk -v p="$pkg" "/^Package: /{name=\$2} name==p && /^Filename: /{print \$2; exit}" /tmp/Packages);
    curl -fsSL -o "${pkg}.deb" "https://deb.debian.org/debian/$FN";
  done &&
  mkdir -p extracted &&
  for f in libnspr4.deb libnss3.deb; do dpkg-deb -x "$f" extracted/; done
'

# 5. Inject NVIDIA_API_KEY into the sandbox
printf 'export NVIDIA_API_KEY=%s\n' "$NVIDIA_API_KEY" \
  | base64 \
  | { B=$(cat); nemoclaw promo-agent exec -- bash -c "mkdir -p /sandbox/.config/promo-agent && printf '%s' '$B' | base64 -d > /sandbox/.config/promo-agent/env.sh && chmod 600 /sandbox/.config/promo-agent/env.sh"; }

# 6. Install the promo skill
nemoclaw promo-agent skill install ./agent/skills/promo
nemoclaw promo-agent exec -- chmod +x \
  /sandbox/.openclaw/skills/promo/scripts/make_promo.sh \
  /sandbox/.openclaw/skills/promo/scripts/write_remotion_project.py
```

### Run

**Option A — From CLI (deterministic, fast):**
```bash
nemoclaw promo-agent exec -- bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh https://benchling.com /sandbox/out.mp4
```
~90 seconds → `/sandbox/out.mp4` (kinetic-typography MP4)

**Option B — Via the agent (autonomous loop):**
```
Open the OpenClaw dashboard:  nemoclaw promo-agent dashboard-url

Type in chat:  "Make a promo video for https://kolr.ai"
```
The agent loads the [`promo`](agent/skills/promo/SKILL.md) skill, calls `openclaw:core:exec` once with the bash command, reports when done.

## Repo layout

```
promo-agent/
├── README.md                 (this file)
├── docs/
│   ├── 2026-05-24-promo-agent-design.md     — Full architectural spec
│   └── 2026-05-24-promo-agent-plan.md       — Implementation plan
├── agent/
│   ├── policy.yaml           — NemoClaw guardrail config (the bonus deliverable)
│   ├── presets/              — Custom NemoClaw network policy presets
│   │   ├── higgsfield.yaml         (kept for asset-mode; deferred for v2)
│   │   ├── github-cdn.yaml
│   │   ├── remotion-cdn.yaml
│   │   ├── debian-mirror.yaml
│   │   ├── brand-fetch.yaml
│   │   └── nemotron-direct.yaml
│   └── skills/
│       ├── promo/            — The skill the agent uses (kinetic mode)
│       │   ├── SKILL.md
│       │   └── scripts/
│       │       ├── make_promo.sh
│       │       ├── write_remotion_project.py
│       │       └── templates/KineticPromo.tsx.template
│       ├── promo-research/   — Brand-research helper (fetch_brand.py)
│       └── render-promo/     — Original asset-mode skill (deferred v2)
└── watchdog/                 — Runtime monitoring scaffolding (used during dev)
```

## How the guardrails work (the bonus story)

[`agent/policy.yaml`](agent/policy.yaml) enforces hard caps via NemoClaw's policy engine. Two highlights:

- **Tool whitelist** — agent can only call the 6 listed tools; everything else is denied at the runtime layer.
- **Network allowlist** — the sandbox proxy denies outbound HTTPS by default. Each policy preset under `agent/presets/` opens a narrow surface (Nemotron API, Debian package mirror, specific brand domains).

A real-world enforcement example from build: when `make_promo.sh` first tried to curl Higgsfield's CDN at `d8j0ntlcm91z4.cloudfront.net`, the sandbox proxy returned **403 Forbidden** until we added it to the `higgsfield` preset. The policy isn't theoretical — it's the only thing letting traffic out.

## Demo video

[YouTube link — Luceo Studio channel]   *(filled in at submission time)*

## What's deferred to v2

- **Higgsfield-asset mode** — adds photo-real images and Seedance video clips. Wired (`--mode=asset`) but kinetic is the v1 demo.
- **Modal-rendered cloud deploy** — production path per the spec.
- **Multi-format export** — 9:16 vertical, 1:1 square. v1 is 16:9 only.
- **Reference-video style matching** (Nemotron 3 Nano Omni multimodal) — premium tier.

## Credits

Built solo by [Dennis Wang](https://github.com/denniswanglabs) for Luceo Studio.
Submitted to NVIDIA GTC Taipei 2026 Hackathon.

Motion patterns adapted from prior Luceo Studio kinetic-light projects (Orinovate, alai-promo).
