# Hackathon Submission Draft — NVIDIA GTC Taipei 2026

Drop-in field content for the submission form. Lengths kept tight.

---

## Project name

Explainer Agent

---

## One-sentence pitch

> *"An autonomous web agent — Nemotron all the way down — that picks every click itself, judges its own progress, and runs under hard NemoClaw policy + seccomp guardrails. Safe by construction, not by prompt."*

Alternates (see "Three elevator pitches to choose from" at bottom).

---

## What it does (150 words)

You give the agent a plain-English goal and a starting URL. It returns a finished MP4 walkthrough of how to reach that goal on the real site, with no human in the loop.

The agent runs in two passes. **Pass 1 — discovery** runs inside a NemoClaw sandbox. At each step, **Nemotron 3 Super 120B** reads the live accessibility tree and picks an action from an 8-verb vocabulary (`click`, `scroll`, `done`, `drag`, `keyboard`, `type`, `clickAt`, `freedraw`). **Nemotron 3 Nano Omni** then judges whether the post-action screenshot advanced the goal. Wrong attempts roll back. Only the filtered action log crosses the sandbox boundary.

**Pass 2 — performance** runs on the host. `replay.js` reads that log, replays the path in headless Chromium, and overlays an SVG cursor with lime click ripples and cubic-eased scrolls. Output: a self-contained explainer video.

The same 8-action vocabulary navigated Stripe docs, NemoClaw docs, and drew the NVIDIA eye logo in Excalidraw — no per-site tuning.

---

## Which NVIDIA products are used

Four NVIDIA products compose one autonomous loop. No third-party model providers anywhere.

- **Nemotron 3 Super 120B** — action selector. Reasons over the accessibility tree at every step.
- **Nemotron 3 Nano Omni 30B** — visual judge. Vets each post-action screenshot. A smaller multimodal critic catches dead ends without paying Super 120B latency on every step.
- **NemoClaw OpenShell** — sandbox runtime. Policy proxy + seccomp filter + filesystem isolation. The guardrail layer the model cannot reach.
- **NVIDIA NIM** — inference endpoint for both Nemotron models.

A single `NVIDIA_API_KEY` powers the whole loop.

---

## How does it use NemoClaw specifically (200 words)

NemoClaw is the load-bearing guardrail layer, and we use it as a multi-sandbox architectural primitive — not a single jailbox.

The agent has full Nemotron-driven autonomy inside the sandbox. Nothing in the prompt restricts where it can navigate. The restriction lives below the agent, at three layers the model cannot reach.

**Network.** Eight YAML presets in `agent/presets/` whitelist exactly the hosts the agent is allowed to reach, applied via `nemoclaw promo-agent policy-add`. A request to any other host returns `403 policy_denied` at the CONNECT verb, before any TLS handshake. We captured this live: the agent emitted a request to `api.openai.com` and the proxy denied it at CONNECT (`explainer-agent/guardrail-clip/evidence/captured-403.txt`). The block is hostname-shaped, not URL-shaped — no path manipulation gets around it.

**Kernel.** `Seccomp: 2` with 4 stacked filters, `NoNewPrivs: 1`, `CapEff: 0`. `socket(AF_NETLINK, ...)` returns `EPERM` while `AF_INET` works — selective syscall filtering, not generic network failure. This is the load-bearing reason Chromium needs its `NetworkServiceInProcess` launch flag.

**Filesystem.** Writable root is `/sandbox` + `/tmp` only. `/`, `/etc`, and the host home directory are unwritable or invisible. A compromised npm dep cannot reach `~/.ssh` or `~/.aws`.

Full evidence is line-cited in `docs/nemoclaw-audit.docx` (10 pages, 6 figures).

---

## Demo video link

`<TBD — combined 60-90s pitch video, Luceo Studio YouTube channel, unlisted at submission time>`

---

## Code repo link

https://github.com/denniswanglabs/promo-agent

---

## What's novel about it (150 words)

**Safe by construction, not by prompt.** Most agent-safety stories are prompt-shaped — the model is asked nicely not to misbehave. This one is enforcement-shaped. If the selector emits `{click, https://api.openai.com/...}`, the CONNECT tunnel returns `403 policy_denied` before TLS starts. A judge can verify this without running anything: eight YAML preset files (auditable in seconds), the captured-403 evidence file, and `/proc/self/status` showing `Seccomp: 2` with 4 stacked filters.

**The agent generalizes.** The same 8-verb vocabulary navigated Stripe's three-click "Map payment data" tutorial AND drew the NVIDIA eye logo in Excalidraw using `freedraw`. Docs and canvas, same agent, same loop.

**The iceberg under the polish.** 30+ rendered iterations. 7 architectural pivots (single-pass → two-pass; Gemini judge → Nemotron Nano Omni; 25fps `recordVideo` → 60fps CDP screencast; single-tab → K=4 beam search). 4 documented Chromium-in-NemoClaw workarounds. ~1865-line sandbox agent runtime. 9 policy presets. Judge-truncation exception handling. Viewport coord-scaling across the sandbox boundary. The visible demos are the tip.

---

## Team

Dennis Wang (solo). Built under the Luceo Studio brand.

---

## Anything we should know (100 words)

The pipeline is site-agnostic. Same discovery loop, same performer, no changes — navigated NemoClaw's own documentation (the canonical demo: the agent runs inside NemoClaw and reads NemoClaw's docs), Stripe's three-click "Map payment data" tutorial, shadcn/ui components, and drew the NVIDIA eye logo in Excalidraw with `freedraw`. Each produced a finished MP4 with no per-site tuning.

**Live demo offer:** the parallel-scout architecture (K=4 simultaneous discovery branches) can be demonstrated live during judging at `http://127.0.0.1:8081/grid.html` — 2x2 scout grid + winner-zoom, real-time, if NVIDIA hardware is available on site.

---

## Three elevator pitches to choose from

Pick one for the form's one-sentence field. Each ≤45 words. Read aloud as a 5-second hook.

**(A) Safe-by-construction angle — recommended**

> An autonomous web agent that picks every click itself, judges its own progress, and produces a polished walkthrough MP4 — every action running under hard NemoClaw policy, seccomp, and filesystem guardrails. The agent has real autonomy; the sandbox holds. Safe by construction, not by prompt.

*45 words. Leads with the architectural win judges will reward. Hits NemoClaw homefield advantage in the first half. "Safe by construction, not by prompt" is the memorable tag.*

**(B) Nemotron all the way down angle**

> Nemotron all the way down: Nemotron 3 Super 120B picks the clicks, Nemotron 3 Nano Omni judges the screenshots, NemoClaw sandboxes the loop, NIM serves both models — four NVIDIA products composing one autonomous web agent that navigates real docs and renders a cinematic walkthrough.

*45 words. Names all four products explicitly. Strongest vendor-stack signal. Risk: less memorable as a five-second hook; reads like a spec.*

**(C) Generalizes from docs to canvas angle**

> One 8-verb agent, one Nemotron loop, no per-site tuning: it navigated Stripe's three-click payment tutorial, found a LoRA example in NVIDIA's docs, and drew the NVIDIA eye logo in Excalidraw. Same agent. Different sites. NemoClaw-sandboxed throughout. The pipeline is the product.

*41 words. Leads with capability breadth — the surprise judges don't expect. "Pipeline is the product" reframes from "look at this demo" to "look at this primitive."*

**Recommended: A.** It lands the strongest unique angle (multi-layer enforcement is rare in agent submissions), it names NemoClaw prominently (homefield), and "safe by construction, not by prompt" is the line judges will quote in their notes. B is the safer narrative if a judge cares more about vendor-stack composition than the safety story. C is the strongest if the room is full of "another browser agent" submissions and you need to differentiate on capability.
