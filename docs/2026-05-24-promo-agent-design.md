# Promo Agent — Design Spec

| | |
|---|---|
| **Project** | NVIDIA GTC Taipei 2026 Hackathon entry |
| **Submission deadline** | 2026-05-28 12:00 |
| **Status** | Design locked, ready for implementation plan |
| **Author** | Dennis Wang |
| **Date** | 2026-05-24 |
| **Repo root** | `~/Desktop/Projects/Hackathons/promo-agent/` |

---

## 1. Overview

Build an autonomous agent that takes a company URL and produces a finished, animated promo video. The agent is the kind of work Dennis does manually today as Luceo Studio — researching a brand, picking a structural template, writing scenes, generating visuals, composing in Remotion, rendering. The agent does all of it end-to-end with no human in the loop.

**Stack:** Nemotron (reasoning) → OpenClaw (agent framework) → NemoClaw (secure sandbox + guardrails) → Vercel Workflow (deterministic pipeline shell) → Modal (render worker) → Higgsfield (visual asset generation) → Vercel frontend.

**Hackathon criteria mapping:**

| Criterion | Our answer |
|---|---|
| Autonomous (no human in loop) | ✓ Single URL input, full pipeline runs unattended |
| Uses Nemotron as core reasoning model | ✓ Nemotron 3 Super 120B via NVIDIA NIM |
| Real task | ✓ Production-grade video generation (extends Dennis's existing studio work) |
| Deployable + persistent | ✓ Vercel-hosted frontend + workflow, NemoClaw sandbox with cloudflared tunnel |
| ⭐ NemoClaw policy-based guardrails (bonus) | ✓ Custom policy file caps LLM calls, web fetches, tool surface, and budget per task |

---

## 2. Goals & Non-Goals

### Goals (in scope for hackathon)

- Type a company URL → 30-60 second animated promo MP4
- **Optionally** accept a reference video URL (YouTube, Vimeo, direct mp4) and **match its visual + pacing style** for the generated promo. Powered by **Nemotron 3 Nano Omni** (multimodal — reads the video natively via Conv3D tubelet embeddings and 256K context).
- Run end-to-end with zero human intervention
- Public URL judges can hit at the NVIDIA booth
- Demonstrate policy-based guardrails working (the bonus criterion)
- Reusable post-hackathon: this becomes Dennis's own Luceo Studio sample-generator

### Non-goals (deferred or out of scope)

- **Phase 2: auto-find CEO email + send pitch** — deferred to post-hackathon
- Reference-video file upload (drag-drop local mp4) — hackathon supports URL input only; upload pipeline is Phase 2
- Voiceover generation (no TTS in scope)
- Multi-format export — 16:9 only for hackathon; 9:16 is nice-to-have
- Real-time interactive editing UI — view-only after agent finishes
- Multi-tenant SaaS-grade infrastructure
- Auto-eval (LLM-as-judge rating own output) — manual eyeball-rating the 5 golden runs is enough for hackathon timeline

---

## 3. Architecture

The system has a **deterministic workflow shell** (crash-safe, pausable, retryable) wrapping an **agentic core** (the one step where Nemotron earns its keep).

```
┌──────────────────────────────────────────────────────────────────┐
│  Next.js Frontend (Vercel)                                       │
│  Inputs: company URL + optional reference video URL              │
│  SSE: live agent stream + final mp4                              │
└────────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│  Vercel Workflow (the SHELL — deterministic, crash-safe)         │
│                                                                  │
│   intake → research → reference_analysis* → ┌─────────────────┐  │
│                          (Nano Omni)        │ composition_plan│  │
│                          *if ref provided   │ (NemoClaw agent)│◀ CORE
│                                             └─────────────────┘  │
│                                                      ▼           │
│   asset_gen → render → blob_upload → deliver                     │
└─────────────────┬──────────────────────────────┬─────────────────┘
                  ▼                              ▼
         ┌─────────────────┐          ┌──────────────────────┐
         │ Modal worker    │          │ Neon Postgres + Blob │
         │ Remotion render │          │ run_state, mp4s      │
         └─────────────────┘          └──────────────────────┘

Tools the NemoClaw agent calls during composition_plan:
  fetch_url   pattern_lookup   script_draft   asset_brief   self_critique
  + analyze_reference_video (only when a reference URL is supplied)

Models in use:
  • Nemotron 3 Super 120B  — main reasoning brain
  • Nemotron 3 Nano Omni   — reference-video analysis (vision+audio+text, Conv3D)
```

**Why this split wins the demo:** judges see a clean status timeline (intake ✓ → research ✓ → planning… → rendering…) while watching the agent's actual reasoning stream inside the planning step. That demonstrates autonomy AND reliability in one screen — which is what the brief asks for.

**Where each piece lives:**

| Code lives in repo | Runs in | How it gets there |
|---|---|---|
| `apps/web/` | Vercel (cloud) | `vercel deploy` |
| `apps/render/` | Modal (cloud) | `modal deploy` |
| `agent/skills/promo/` | NemoClaw sandbox (Dennis's Mac) | `nemoclaw promo-agent skill install ./agent/skills/promo` |
| `agent/policy.yaml` | NemoClaw policy engine (Dennis's Mac) | `nemoclaw promo-agent policy-add --from-file ./agent/policy.yaml` |

---

## 4. Components

### Frontend (Next.js on Vercel)

| Component | Job | Talks to |
|---|---|---|
| `app/page.tsx` | Single input form (company URL). Submit triggers a workflow run. | `POST /api/runs` |
| `app/runs/[id]/page.tsx` | Live status board. Streams step progress + agent reasoning. Final video plays inline. | `GET /api/runs/:id/stream` (SSE) |

### Server shell (Vercel Workflow + API routes)

| Step | Job | Talks to |
|---|---|---|
| `intake` | Validate URL(s), create run row in Postgres, return run ID | Neon |
| `research` | Deterministic crawl of input URL (HTML + CSS + 2-3 internal links). Extract brand tokens (palette, fonts, hero copy, stats, logos). | Target site, Neon |
| `reference_analysis` *(optional)* | If user provided a reference video URL: `yt-dlp` to download, send to Nemotron 3 Nano Omni via the agent's `analyze_reference_video` tool, return `ReferenceStyle` JSON. Cached by video URL hash. Skip step entirely if no reference provided. | yt-dlp, NemoClaw sandbox, Neon (cache) |
| `composition_plan` | **The agentic core.** Hands `BrandResearch` + optional `ReferenceStyle` to NemoClaw sandbox; receives back a frozen JSON `CompositionSpec`. | NemoClaw sandbox API |
| `asset_gen` | For each scene's `asset_brief`, call Higgsfield in parallel. Cache by prompt hash. | Higgsfield, Neon (cache), Blob (assets) |
| `render` | Pass spec + assets to Modal. Block until MP4 path returns. | Modal |
| `deliver` | Upload MP4 to Blob, store URL in Neon, push final SSE event. | Blob, Neon |

### NemoClaw sandbox (the agentic core)

| Component | Job |
|---|---|
| OpenClaw agent (`promo-agent`) | ReAct loop. Decides tool calls, reads results, critiques, retries. **Nemotron 3 Super 120B** for general reasoning; **Nemotron 3 Nano Omni** for video analysis (vision+audio+text, Conv3D tubelet embeddings, 256K context). |
| Tool: `fetch_url(url)` | HTTP GET, returns parsed text + extracted CSS palette. Custom (we built it, replaces Brave Search). |
| Tool: `analyze_reference_video(url)` | `yt-dlp` downloads to a sandbox-scoped temp dir, extracts video segment (max first 90s), sends to Nemotron 3 Nano Omni with a structured-output prompt. Returns `ReferenceStyle` JSON. Cached by URL hash to Neon. One call max per task (policy). |
| Tool: `pattern_lookup(category)` | Returns structured summary of Apple-style / Kinetic-light / Zelios templates from a static JSON library. |
| Tool: `script_draft(brand, scene_type)` | Nemotron-only call (no external). Writes copy for a scene. |
| Tool: `asset_brief(scene, brand)` | Generates Higgsfield prompts per scene. Output flows to `asset_gen` workflow step (agent doesn't call Higgsfield directly — cost control). |
| Tool: `self_critique(spec, rubric)` | Agent rates its own composition_plan. Decides regenerate or ship. Bounded by policy: max 3 critique rounds. |
| NemoClaw policy file | Caps and tool whitelist. THIS is what earns the bonus. See § 9. |

### Modal worker

| Component | Job |
|---|---|
| `render(spec, assets) -> mp4_path` | Container with Remotion CLI. Writes the composition TSX from the spec, downloads assets, runs `npx remotion render`, returns the MP4. ~2-4 min per video. |

### Storage

| Component | Job |
|---|---|
| Neon Postgres | `runs` (status, input, output URL), `assets` (cache by prompt hash), `events` (SSE replay) |
| Vercel Blob | Generated images/clips + final MP4s |

### Key boundary decisions

- **Why isn't `higgsfield_generate` exposed as an agent tool?** Cost control. The agent emits a *brief* per scene; the deterministic `asset_gen` workflow step actually calls Higgsfield, capped by policy. NemoClaw enforces the boundary even if Nemotron tries to escape.
- **Why is the agent inside one workflow step?** Crash-safety + observability. Deterministic plumbing belongs in workflow steps; creative decisions belong in the agent. Resume a failed `render` step without re-running the agent.
- **Why our own `fetch_url` and not Brave Search?** Brave's free tier was killed Feb 2026 ($5/mo credit + card + attribution required). Direct URL fetch covers ~80% of what our agent needs for the demo (judges supply URLs, not company names). Custom tool stays free, fully under our policy control.

---

## 5. Data Flow

End-to-end run for `buildtrayd.com` with an optional reference video `https://youtu.be/heygen-launch`:

```
Frontend                Workflow shell                NemoClaw            Modal
   │                          │                            │                 │
   │ POST /api/runs           │                            │                 │
   │ { url: "buildtrayd.com", │                            │                 │
   │   referenceUrl: "..." }  │                            │                 │
   ├─────────────────────────▶│                            │                 │
   │                          ├── intake → runId           │                 │
   │ ◀── { runId: "r_42" } ───┤                            │                 │
   │ GET stream               │                            │                 │
   ├═════════ SSE ═══════════▶│                            │                 │
   │                          ├── research                 │                 │
   │ ◀═ research_done ════════┤                            │                 │
   │                          ├── reference_analysis ─────▶│                 │
   │                          │   (only if ref provided)   ├ analyze_reference_video │
   │ ◀═ reference_analyzed ═══┤◀── ReferenceStyle ─────────┤  (Nano Omni)    │
   │                          ├── composition_plan ───────▶│                 │
   │                          │                            ├ pattern_lookup  │
   │ ◀═ agent_step ═══════════┤◀═ step events ═════════════┤ script_draft    │
   │ ◀═ agent_step ═══════════┤                            │ asset_brief     │
   │ ◀═ agent_step ═══════════┤                            │ self_critique   │
   │                          │◀── CompositionSpec ────────┤                 │
   │                          ├── asset_gen (parallel)     │                 │
   │ ◀═ assets_progress ══════┤                            │                 │
   │                          ├── render ──────────────────┼────────────────▶│
   │ ◀═ render_progress ══════┤◀═══════════════ mp4 path ══════════════════ ─┤
   │                          ├── deliver (blob + DB)      │                 │
   │ ◀═ complete { url } ═════┤                            │                 │
```

### Schemas at handoffs

**`BrandResearch`** (research → agent):
```json
{
  "url": "https://buildtrayd.com",
  "title": "Trayd — Construction back-office",
  "hero_copy": "Run your construction back-office in one place",
  "palette": { "primary": "#0F1B2D", "accent": "#D4FF00", "neutral": "#FAFAFA" },
  "fonts": ["Inter", "JetBrains Mono"],
  "stats_found": ["13m 46s", "27 min", "7 min"],
  "logos": ["https://buildtrayd.com/customers/foo.png"],
  "internal_pages": [{ "url": "/features", "text_excerpt": "..." }]
}
```

**`ReferenceStyle`** (reference_analysis → agent, only when a reference URL was supplied):
```json
{
  "source_url": "https://youtu.be/heygen-launch",
  "duration_analyzed_s": 90,
  "pacing": {
    "avg_scene_duration_s": 2.4,
    "scene_count": 12,
    "rhythm": "fast-cut with rare 4-second hold moments"
  },
  "visual_style": {
    "palette": { "dominant": "#0F1B2D", "accent": "#FFD700", "neutrals": ["#FAFAFA", "#1A1A1A"] },
    "type_treatment": "large kinetic display sans-serif, white on dark, occasional reverse-mask reveals",
    "composition": "mostly center-anchored, occasional left-third splits, frequent full-bleed product shots"
  },
  "motion_style": {
    "transitions": ["whip-pan", "cross-dissolve", "match-cut on type"],
    "camera_movement": "static cuts with subtle parallax + zoom-in on key text"
  },
  "audio_style": {
    "music_genre": "lo-fi corporate, ~110 bpm",
    "music_rhythm": "drops align with scene cuts on bars 4 and 8",
    "voiceover": false
  },
  "tone": "energetic, technical, confident",
  "structural_arc": ["cold open", "problem", "product reveal", "feature montage", "cta"]
}
```

**`CompositionSpec`** (agent → asset_gen):
```json
{
  "template": "apple-style-30s",
  "total_duration_f": 900,
  "palette": { "primary": "#0F1B2D", "accent": "#D4FF00" },
  "scenes": [
    {
      "act": 1, "duration_f": 60, "type": "problem",
      "copy": ["Construction back-office is a mess"],
      "asset_brief": "Frustrated PM at messy desk, navy + lime accent, photo realism",
      "asset_type": "image"
    },
    {
      "act": 2, "duration_f": 240, "type": "solution_reveal",
      "copy": ["Trayd", "27 minutes to set up"],
      "asset_brief": "Clean SaaS dashboard, navy header, lime CTA",
      "asset_type": "video"
    }
  ],
  "music_brief": "lo-fi corporate, 110bpm, hopeful resolution"
}
```

**`AssetBundle`** (asset_gen → render):
```json
{
  "scene_1": { "url": "blob:...scene_1.png", "type": "image" },
  "scene_2": { "url": "blob:...scene_2.mp4", "type": "video", "duration_s": 8 }
}
```

**Final** (deliver → frontend):
```json
{ "videoUrl": "blob:...trayd_promo_r_42.mp4", "durationSec": 30 }
```

### The agent's contract (the linchpin)

| Direction | What | Constraint |
|---|---|---|
| Agent receives | `BrandResearch` + **optional `ReferenceStyle`** + read-only pattern library | Bounded scope |
| Agent may call | `fetch_url`, `analyze_reference_video`, `pattern_lookup`, `script_draft`, `asset_brief`, `self_critique` | 6 tools, no others |
| Agent must return | `CompositionSpec` (strict JSON schema). If `ReferenceStyle` was provided, the spec's palette/pacing/transitions should visibly inherit from it. | Validated before next step; reject + reprompt on fail |
| Agent cannot | Call Higgsfield, render, upload, email, exit sandbox | NemoClaw policy enforces |
| Bounded by | 25 LLM calls / task, 3 critique rounds, 10 fetches / task, **1 Nano Omni call / task** | Policy file (§ 9) |

### Why this shape

- `CompositionSpec` is JSON, not code → render step is deterministic, replayable. Same spec + assets → same video.
- Agent doesn't touch Higgsfield directly → cost stays controlled. Policy is safety net, not the only line of defense.
- Every artifact persisted in Neon → any step is independently replayable. Crash mid-render? Resume from `render` step.

---

## 6. Error Handling

### Failure modes mapped to recovery

| Step | What can fail | Response |
|---|---|---|
| research | Site 5xx | Exponential backoff (1s/4s/16s), then fail with "couldn't reach site" |
| | JS-only SPA, empty HTML | Escalate to `nous-browser` headless fetch, retry once |
| | Sparse content | Don't fail — pass minimal `BrandResearch`, agent works with less |
| reference_analysis | `yt-dlp` can't download (private video, 404, region-locked, DRM) | Skip step, log warning, continue with brand-only generation. User sees: "Couldn't fetch reference video — generating from brand only." |
| | Video > 90s | Truncate input to first 90s before sending to Nano Omni |
| | Nano Omni timeout / empty response / refuses content | Skip step, fall back to brand-only |
| | yt-dlp not installed in sandbox | Hard fail with clear setup instruction (caught at Day 2 build, not at runtime in practice) |
| composition_plan | Nemotron 429 | NemoClaw retries with backoff (built-in) |
| | Agent exceeds 25-call cap | NemoClaw kills loop, returns last valid spec or "agent gave up" |
| | Malformed `CompositionSpec` | Reprompt with validation error inline. Max 2 reprompts. Then fail with last attempt. |
| | Critique loop runaway | Policy enforces max 3 critique rounds — infinite loops impossible |
| | Sandbox crash | Step times out, marked failed, retryable from research output |
| | Tool returns error | Tool returns error string → agent decides whether to retry, route around, or proceed |
| asset_gen | One scene's generation fails | Retry 2x with prompt jitter, then placeholder + `degraded: true` |
| | Higgsfield rate limit | Workflow's parallel layer queues + backs off |
| | Cost cap hit | Halt run, mark `partial`, save what we have |
| render | Modal timeout (>10 min) | Mark failed. Spec + assets preserved → retry is free, no agent re-run |
| | Invalid Remotion TSX | Catch at compile, request agent to simplify, max 1 redo |
| | Asset URL 404 | Substitute placeholder, log, render proceeds |
| | Modal OOM | Auto-bump tier, retry once |
| deliver | Blob upload fails | Retry 3x, fallback to local path |
| | DB write fails | Retry, then enqueue via Vercel Queues |
| Frontend SSE | Client disconnects | Server-side workflow keeps running. Client reconnects, replays from Postgres event ID. |

### Cross-cutting principles

1. Every step persists output to Postgres BEFORE next step starts → single-step retry, not full rerun.
2. Vercel Workflow's pause/resume gives crash-safety for free.
3. **Layered budget defense:** workflow-level ($5 of Higgsfield per run), agent-level (max 5 `asset_brief` calls per task), policy-level (NemoClaw kills agent at 25 LLM calls). If two safety nets fail, the third still catches.
4. **Degraded > failed.** Ship partial result with a flag, never a hard error. A video with one solid-color scene is still demo-able.

### User-visible status states

| State | Display |
|---|---|
| In progress | Live step name + spinner + agent's last reasoning line |
| Recoverable error (retrying) | "Couldn't reach buildtrayd.com on first try — retrying…" — no scary red |
| Cost cap | Soft: "Agent had to stop early — try different brand or wait" |
| Bug-shaped fail | "Hit a bug, sorry. Run ID r_42 — paste this if reporting." |
| Done | Inline video player + "Download MP4" |

---

## 7. Testing

**Philosophy:** shape tests cheap, output quality manual. Agents are non-deterministic; you can't pin LLM outputs.

### Test pyramid

| Layer | What | How | When |
|---|---|---|---|
| Pure functions | HTML parser, palette extractor, prompt formatters, JSON schema validators | Vitest, no externals | Every commit (~2s) |
| Tool contracts (mocked) | `fetch_url` shape on 200/404/500; `script_draft` prompt structure | Vitest + nock | Every commit |
| Schema validation | Sample `BrandResearch` + `CompositionSpec` validate against schema | Vitest + ajv | Every commit |
| Workflow step shape | Each step's input→output matches contract (adjacent steps mocked) | Vitest + workflow harness | Every commit |
| Golden runs (5 brands) | Trayd, Benchling, Cumie, JGB, iKala — full pipeline E2E | Manual run + eyeball-rate | Before submission + before any booth demo |
| Pre-demo smoke | All systems green | `./scripts/smoke.sh` | 30 min before demo |

### The 5 golden inputs

| Brand | URL | What it tests |
|---|---|---|
| Trayd | buildtrayd.com | Strong navy/lime palette, real stats — color extraction + numeric scraping |
| Benchling | benchling.com | Dense SaaS UI, navy — UI-heavy aesthetic |
| Cumie | cumie.app/zh | Chinese site, 9:16 use case — multi-language + aspect ratio |
| iKala Kolr | kolr.ai | Violet accent, KOL space — non-corporate palette |
| JGB Property | jgbproperty.com | Real estate — new vertical, exposes weak spots |

Score each on (a) brand fit, (b) pacing, (c) would-you-send-this. Below 3/5 → bug.

### What we WON'T build

- VCR-style replay cassettes (infra cost vs 4-day budget)
- LLM-as-judge auto-eval (calibration would eat 1-2 days)
- Snapshot testing on rendered MP4 (video is non-deterministic, pixel-diff is useless)
- Load testing (hackathon demo is 1-10 judges in series, not 1,000 concurrent)

### Pre-demo smoke script

```bash
# ./scripts/smoke.sh — 30 min before any booth demo
set -e
echo "→ Nemotron reachable..."
curl -sf https://integrate.api.nvidia.com/v1/models \
  -H "Authorization: Bearer $NVIDIA_API_KEY" > /dev/null
echo "→ NemoClaw sandbox healthy..."
nemoclaw promo-agent status | grep -q "Inference: healthy"
echo "→ Public tunnel alive..."
nemoclaw promo-agent dashboard-url --quiet | head -c 4 | grep -q "http"
echo "→ Modal worker deployed..."
modal app list | grep -q "promo-agent-render"
echo "→ Vercel deployment current..."
vercel inspect $PROD_URL | grep -q "Ready"
echo "✓ All systems green"
```

### Backup plan

Pre-render 3 demo videos (Trayd, Benchling, Cumie) before the booth. If live demo fails, play the pre-recorded video and walk the judges through the run log instead.

---

## 8. Build Phases (high-level — detailed plan in writing-plans output)

| Day | Goal |
|---|---|
| 1 | Scaffold monorepo. NemoClaw skills + policy file (5 brand-only tools). End-to-end pipeline with stub assets (mock Higgsfield). One known-good `CompositionSpec` rendered to MP4. |
| 2 | Real Higgsfield integration. Modal render worker. Frontend SSE wiring. First real run on Trayd. **Add `analyze_reference_video` tool + `reference_analysis` step + frontend optional reference URL field** (afternoon). |
| 3 | Polish. Run all 5 golden inputs (without ref) + 2-3 with reference video (e.g. HeyGen launch as ref → Trayd promo). Smoke test script. Public Vercel deploy. NemoClaw cloudflared tunnel for live booth access. |
| 4 | Buffer for fixes. Pre-render booth backup videos (one of them must showcase reference-style matching). Submit. Possibly record a 2-min screencast for the submission write-up, emphasizing reference-video feature as the headline. |

---

## 9. NemoClaw Policy File (the bonus story)

Concrete policy enforced by NemoClaw on every agent action:

```yaml
# agent/policy.yaml — applied via:
#   nemoclaw promo-agent policy-add --from-file ./agent/policy.yaml

version: 1
sandbox: promo-agent

caps:
  max_llm_calls_per_task: 25
  max_web_fetches_per_task: 10
  max_critique_rounds_per_task: 3
  max_asset_briefs_per_task: 5         # cap before workflow refuses asset_gen
  max_nano_omni_calls_per_task: 1      # reference video analyzed once, cached after
  max_higgsfield_spend_usd_per_task: 5
  max_task_wall_clock_minutes: 12       # +2 min vs. brand-only to allow ref download

tools_whitelist:
  - fetch_url
  - analyze_reference_video
  - pattern_lookup
  - script_draft
  - asset_brief
  - self_critique

tools_blacklist:
  - subprocess                          # except yt-dlp via the controlled tool path
  - filesystem_outside_sandbox
  - email
  - direct_higgsfield_call

network:
  # The research target is dynamic per run. Rather than rewriting the policy on
  # every request, NemoClaw stays open for outbound HTTPS to anything not on the
  # blacklist, and the `fetch_url` tool itself is the chokepoint — it rate-limits
  # per domain and refuses non-public IPs / file:// / etc.
  outbound_default: allow_https_with_logging
  outbound_blacklist:
    - 169.254.169.254          # cloud metadata
    - 10.0.0.0/8               # private nets
    - 192.168.0.0/16
    - file://
  always_allow:
    - integrate.api.nvidia.com  # Nemotron (Super + Nano Omni)
    - api.telegram.org           # bot interface
    - "*.youtube.com"            # reference video downloads via yt-dlp
    - "*.googlevideo.com"        # YouTube CDN backend
    - "*.vimeo.com"              # Vimeo references
    - "*.vimeocdn.com"

privacy:
  no_pii_in_generated_copy: true   # post-generation regex check
  brand_claim_grounding_required: true  # generated stats must trace to fetched source
```

**Scope of the per-task cap:** `max_higgsfield_spend_usd_per_task: 5` bounds a *single video generation*. Total hackathon spend across many runs is uncapped per Dennis's "optimize to win" call (see § 11). Realistic worst case: 20-40 dev runs + ~10 booth runs × $5 = $50-200 total. The per-task cap is the safety net that prevents one runaway agent from burning the whole budget in one go.

This policy file is the deliverable for the bonus criterion. The submission write-up will reference it and show one specific intercept (e.g. "agent tried to spend $6 on Higgsfield; policy blocked at $5; agent adapted with 4 scenes instead of 6").

---

## 10. Open Questions / Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Agent produces invalid Remotion TSX from a JSON spec | High | Generate Remotion code from a template, not from scratch. Spec → template-filler function in code, not in agent. |
| Higgsfield concurrent rate limits at booth demo | Medium | Pre-generate assets for known brands; cache by prompt hash. Live demo uses cache hits. |
| NemoClaw sandbox stability over 4-day sustained use | Low | Cloudflared tunnel keeps it reachable. `nemoclaw promo-agent recover` if it crashes. |
| Vercel Workflow SSE streaming gaps | Low | Verify in Day 1; fallback is polling endpoint that reads Postgres event log. |
| Free Nemotron tier rate-limits at booth | Medium | NemoClaw policy throttles agent loop. Fallback to Nano 9B for tool-orchestration calls if Super 120B throttles. |
| The agent reasons over Dennis's existing pattern library files in real time | Medium | Make `pattern_lookup` return a *summary* (one paragraph per pattern), not the full source. Cheaper tokens, faster reasoning. |
| `yt-dlp` fails on a chosen reference video (age-gated, DRM, region-locked) | Medium | Fall back to brand-only mode automatically; surface friendly message in UI. Pre-test the 2-3 reference videos used in booth demos to ensure they download. |
| `ReferenceStyle` output from Nano Omni is too generic to meaningfully shape the spec | Medium | Day 2 budget includes 1-2 hr of prompt-engineering iteration on the `analyze_reference_video` system prompt. Validate by running 3 different reference videos and confirming the output differs meaningfully. |
| Nano Omni multimodal endpoint behaves differently from text-only Nemotron API | Low-Medium | Test the endpoint on Day 2 morning before building the tool. NVIDIA's docs say OpenAI-compatible, but multimodal payloads have specific shapes — verify early. |

---

## 11. Cost ceiling

| Service | Expected cost (4 days dev + demo) |
|---|---|
| Nemotron 3 Super 120B (NVIDIA NIM) | $0 — free tier, no card on file |
| Nemotron 3 Nano Omni (vision) | $0 — free tier per OpenRouter listing. If paid kicks in: ~$0.01-0.10 per reference analysis × ~30 analyses = single-digit dollars max. |
| NemoClaw | $0 — open source |
| Higgsfield | "no ceiling, optimize to win" per Dennis. Realistic: $50-200 across dev iterations + booth demos. |
| Modal | $5-10 — render compute only |
| Vercel | $0 — free tier covers hackathon traffic |
| Neon Postgres | $0 — free tier (1 GB, plenty) |
| Vercel Blob | $0 — free tier (5 GB, plenty for ~50 MP4s) |
| Telegram | $0 |
| **Total** | **$55-220** worst case, mostly Higgsfield |

---

## 12. Out-of-design appendix

**Things outside this spec, captured for visibility:**

- Submission write-up + 2-min screencast will reference this design doc by path
- NemoClaw policy file (§ 9) is the literal bonus criterion artifact — submission should cite it explicitly
- If we ship a public URL, write-up should include the tunnel URL + a runbook for judges to try one brand themselves
- Post-hackathon Phase 2 (email autopilot) re-uses the same shell; only adds a `deliver_email` step and a `contact_discover` tool. Mentioned for narrative completeness, not in scope.
