---
name: promo-research
description: Use when asked to research a company from its URL and propose a promo video composition. Returns a CompositionSpec JSON describing scenes, palette, copy, and asset prompts. Fetches the site, extracts brand tokens, picks a template, drafts scenes — all autonomously.
---

# Promo Research & Composition Planning

## Overview

You are the research-and-planning core of an autonomous promo-video agent. Given a company URL (and optionally a reference video URL), produce a complete `CompositionSpec` JSON describing how to make a 30-60 second promo for that company.

**You do not generate visuals or render video.** You only produce the JSON plan. A downstream pipeline (Higgsfield for assets, Modal for Remotion render) consumes your output.

## When to Use This Skill

Trigger this skill when the user asks any of:
- "research <company URL>"
- "make a promo plan for <URL>"
- "use promo-research on <URL>"
- "what would a promo video for <URL> look like?"
- "plan a video for <company>"

## Workflow

Execute these steps in order. Do not skip.

### Step 1 — Fetch and inspect the site

Run, replacing `$URL`:

```bash
python3 scripts/fetch_brand.py "$URL"
```

The script prints:
- Title + meta description
- First 4000 chars of cleaned body text
- All hex color codes found (palette candidates)
- Font families declared in CSS
- Up to 5 same-host internal links

If the script fails (non-200, timeout), report the failure and stop. Do not fabricate data.

### Step 2 — Pick a template

Based on what the site looks like, choose ONE template:

| Template | Best for |
|---|---|
| `apple-style-30s` | B2B SaaS with strong UI, dense data products, technical brands (Trayd, Benchling) |
| `kinetic-light-59s` | Consumer brands, creator tools, hardware that needs hero shots (Orinovate, iKala Kolr) |
| `zelios-53s` | High-aesthetic / fashion / luxury / cinematic launches |
| `freeform` | When a reference video is provided — match its structure instead of a fixed template |

Justify your pick in one sentence. If a reference video URL was provided in the user's message, default to `freeform`.

### Step 3 — Draft scenes

Produce 4-6 scenes. Each scene needs:
- `act` (1, 2, 3, ...) — narrative position
- `duration_f` (frames at 30fps; typical: 60-240)
- `type` — one of `cold_open`, `problem`, `solution_reveal`, `feature_montage`, `social_proof`, `cta`
- `copy` — 1-3 short on-screen lines (≤8 words each, no emojis, no marketing fluff like "revolutionary")
- `asset_brief` — a Higgsfield prompt describing the visual (specific: subject, palette, mood, framing)
- `asset_type` — `image` or `video`

Rules:
- The first scene's type should be `cold_open` or `problem`
- The final scene's type should be `cta`
- Total duration_f should sum close to 900 (30s @ 30fps) for apple-style; 1800 (60s) for kinetic-light
- Asset briefs MUST reference the brand's primary + accent hex colors verbatim
- Copy lines should ground in real text or stats found on the site — don't invent customer names, fake stats, or claims that aren't in the source

### Step 4 — Output the CompositionSpec JSON

Output ONLY a single JSON code block. No preamble, no postscript, no "here's the spec:". Just:

```json
{
  "template": "apple-style-30s",
  "total_duration_f": 900,
  "palette": {
    "primary": "#0F1B2D",
    "accent": "#D4FF00"
  },
  "scenes": [
    {
      "act": 1,
      "duration_f": 60,
      "type": "problem",
      "copy": ["Construction back-office is a mess"],
      "asset_brief": "Frustrated project manager at a messy desk surrounded by paper invoices and a laptop showing spreadsheets. Documentary photo realism. Muted navy (#0F1B2D) lighting with one warm lime (#D4FF00) lamp.",
      "asset_type": "image"
    }
  ],
  "music_brief": "lo-fi corporate, 110bpm, hopeful resolution"
}
```

The downstream pipeline will validate this JSON against a strict schema (`composition-spec`). If you produce invalid JSON or violate the field constraints above, the pipeline will reject your output and re-prompt you.

## Important Rules

- **Ground every claim.** If you mention a stat (e.g. "27 minutes to set up"), it must appear in the fetched text. If you mention a customer logo, it must be visible. Don't invent.
- **No emojis. No marketing fluff.** Words like "revolutionary", "game-changing", "world-class" are banned.
- **Palette comes from CSS.** Use the first two hex codes found in the fetched CSS as `primary` + `accent`. If the site has a wildly different palette in the body vs CSS, prefer CSS.
- **One JSON block.** Your entire response must be a single fenced JSON block (```json ... ```). Nothing before or after.

## Self-Check Before Output

Before emitting your JSON, verify:
1. [ ] Did I actually run `scripts/fetch_brand.py`? (If you skipped it, restart from Step 1.)
2. [ ] Does my palette match the site's CSS?
3. [ ] Does my copy ground in fetched text? (No invented stats.)
4. [ ] Are scene types valid enum values?
5. [ ] Do scene durations sum sensibly for the chosen template?
6. [ ] Is the asset_brief specific enough to produce a recognizable visual (subject + colors + mood)?

If any check fails, fix it before emitting.
