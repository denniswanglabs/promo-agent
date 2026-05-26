# Explainer Agent — NVIDIA GTC Taipei 2026 Hackathon Submission

## Hackathon

NVIDIA GTC Taipei 2026 — agent autonomy + guardrails track.

## Team

Dennis Wang (solo) — `denniswanglabs@gmail.com` — built under the Luceo Studio brand.

## What we built

**Explainer Agent.** An autonomous web agent that finds its own way to anywhere on a real website and renders the path as a polished walkthrough video — every click made inside a NemoClaw sandbox whose proxy, seccomp filter, and filesystem boundary are non-negotiable.

You give it a plain-English goal and a starting URL. It opens a real browser inside the sandbox, reads the page, decides where to click, scrolls, backtracks when it goes the wrong way, and stops when the visual judge says the goal is on screen. A second pass on the host replays the discovered path with a smooth cursor and writes an MP4.

The agent's autonomy is real: nothing in the prompt restricts where it can navigate. The constraints live below the agent — at the network proxy, the kernel syscall filter, and the filesystem boundary. A jailbroken Nemotron output asking for `api.openai.com` cannot escape, because the CONNECT tunnel returns `403 policy_denied` before TLS even starts.

### What this took (the iceberg under the polish)

This wasn't a single-prompt demo. The submission represents **29 rendered submission videos**, **30+ orchestrated subagent dispatches**, **7 architectural pivots** (single-pass → two-pass; Gemini judge → Nemotron Nano Omni; 25fps `recordVideo` → 60fps CDP `Page.startScreencast`; single-tab → K-context beam search; navigation-only vocabulary → multi-vocab including `drag` / `keyboard` / `type` / `clickAt`; full overlays → minimal → pixel-precise full overlays; NVIDIA docs → Stripe + shadcn + Excalidraw), and **4 documented Chromium-in-NemoClaw workarounds** (`NetworkServiceInProcess` + `disable-features=NetworkService`, `connectOverCDP` instead of `chromium.launch`, `--ignore-certificate-errors` for the proxy MITM, `--use-angle=swiftshader-webgl`). Each working demo was the result of real engineering investment — judge-strictness exception handling, viewport coord-scaling (1440×900 sandbox → 2560×1440 host), screencast pipeline replacement, action-vocabulary extension, allowlist iteration across **9 policy presets**, and a **~1865-line sandbox agent runtime**. The polish is the iceberg's tip.

## How it satisfies the agent-autonomy + guardrails theme

Most agent-safety narratives are prompt-shaped. This one is enforcement-shaped. Mapping the theme to concrete artifacts:

| Theme criterion | How this project satisfies it | Evidence |
|---|---|---|
| **Autonomy** — agent decides its own actions, no human in the loop | Nemotron 3 Super 120B picks every click/scroll. Nemotron 3 Nano Omni judges whether each step advanced the goal. Wrong attempts are rolled back via `page.goto(previousUrl)`. The agent stops itself when the judge returns `at_destination: true`. | `explainer-agent/agent.js`, `v11-action-log.json` (real recorded runs) |
| **Guardrails — network** | Eight YAML presets in `agent/presets/` whitelist exactly the hosts the agent is allowed to reach. A request to any other host hits `403 policy_denied` at the CONNECT verb, before any TLS handshake. | `docs/nemoclaw-audit.md` §1, `explainer-agent/guardrail-clip/evidence/captured-403.txt` |
| **Guardrails — kernel** | `Seccomp: 2` (filter mode) with 4 stacked filters. `NoNewPrivs: 1`. `CapEff: 0`. `socket(AF_NETLINK, ...)` returns EPERM while `AF_INET` works — proving selective syscall filtering, not a generic network failure. | `docs/nemoclaw-audit.md` §2, `explainer-agent/guardrail-clip/evidence/captured-seccomp-status.txt`, `captured-netlink-blocked.txt` |
| **Guardrails — filesystem** | Writable root is `/sandbox` + `/tmp` only. `/`, `/etc`, and `/Users/dennis` (host home) are unwritable or non-existent. A compromised npm dep cannot reach host secrets. | `docs/nemoclaw-audit.md` §3, `captured-fs-isolation.txt` |
| **Theme honesty test** — can the agent escape if jailbroken? | No. If the model emitted `{click, https://api.openai.com/keys}`, the CONNECT 403 fires before any HTTP payload is sent. The block is hostname-shaped, not URL-shaped, so no path manipulation gets around it. | `docs/nemoclaw-audit.md` §5 |

The guardrails are visible to a judge in three places: the eight YAML preset files (auditable in seconds), the captured-403 evidence file (one CONNECT, one denial), and the seccomp `/proc/self/status` capture (kernel-level proof).

## NVIDIA stack used

Every model and every runtime component in this submission is from NVIDIA. No third-party model providers.

- **Nemotron 3 Super 120B** (`nvidia/nemotron-3-super-120b-a12b`) via NVIDIA NIM at `https://integrate.api.nvidia.com/v1/chat/completions` — **action selection**. Given the page accessibility tree + a screenshot, it returns a structured `{click, scroll, done}` action. Called at every step of the discovery loop.
- **Nemotron 3 Nano Omni 30B** via the same NIM endpoint — **visual judging**. Given the post-action screenshot + the user goal text, it returns `{at_destination, on_right_track, reasoning}`. Using a smaller multimodal model as a critic catches dead ends the planner missed without paying Super 120B latency on every step.
- **NemoClaw OpenShell** — the sandbox runtime. Provides the policy proxy at `10.200.0.1:3128`, the seccomp filter (`Seccomp: 2`, 4 filters), the filesystem isolation (`/sandbox` writable root, host paths invisible), and the policy-preset system (`nemoclaw promo-agent policy-add --from-file <preset.yaml>`).

Single `NVIDIA_API_KEY` powers both models — they share the NIM endpoint.

## Demo video

YouTube link (Luceo Studio channel, unlisted at time of submission): `<filled in at upload time>`

## Audit document

[`docs/nemoclaw-audit.docx`](docs/nemoclaw-audit.docx) — 10 pages, 6 figures, every claim line-cited against captured evidence in `explainer-agent/guardrail-clip/evidence/` or line ranges in `agent/presets/*.yaml`. Reproduction commands are included in the appendix.

A plaintext mirror lives at [`docs/nemoclaw-audit.md`](docs/nemoclaw-audit.md).

## Reproduce

```bash
git clone <REPO_URL> promo-agent
cd promo-agent

# Apply the 8 policy presets to the running sandbox (active policy is v40)
for f in agent/presets/*.yaml; do
  nemoclaw promo-agent policy-add --from-file "$f" --yes
done

# Push the agent into the sandbox (canonical handoff path: host → base64 → sandbox)
cat /tmp/sandbox-agent.js | base64 \
  | nemoclaw promo-agent exec -- bash -c 'base64 -d > /sandbox/explainer-agent/agent.js'

# End-to-end run
./explainer-agent/make-explainer.sh \
  "find the LoRA fine-tuning example for Nemotron" \
  "https://docs.nvidia.com/nemoclaw/latest/home" \
  20
```

Policy presets to inspect (auditable in seconds — these ARE the guardrail):

```
agent/presets/demo-targets.yaml       12 demo navigation hosts (shadcn, NVIDIA docs)
agent/presets/nemotron-direct.yaml    integrate.api.nvidia.com:443 only
agent/presets/github-cdn.yaml         GitHub HTTPS GET only
agent/presets/playwright-cdn.yaml     Playwright/Chromium download mirrors
agent/presets/remotion-cdn.yaml       Remotion + Chrome headless shell assets
agent/presets/debian-mirror.yaml      deb.debian.org direct .deb downloads
agent/presets/higgsfield.yaml         Higgsfield API + CDN
agent/presets/brand-fetch.yaml        per-domain brand-site GETs (no wildcards)
```

Evidence files to inspect:

```
explainer-agent/guardrail-clip/evidence/captured-403.txt
explainer-agent/guardrail-clip/evidence/captured-allowed-200.txt
explainer-agent/guardrail-clip/evidence/captured-seccomp-status.txt
explainer-agent/guardrail-clip/evidence/captured-netlink-blocked.txt
explainer-agent/guardrail-clip/evidence/captured-fs-isolation.txt
explainer-agent/guardrail-clip/evidence/captured-proxy-env.txt
```

## Team

Dennis Wang — `denniswanglabs@gmail.com` — solo submission. Built under the Luceo Studio brand ([luceo-site.vercel.app](https://luceo-site.vercel.app)).
