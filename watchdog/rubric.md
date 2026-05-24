# Promo-Agent Watchdog Rubric

How to evaluate one agent run. Apply to every captured run; record findings in `runs/<id>/review.md`.

## Hard checks (binary pass/fail)

1. **MP4 produced** — `out.mp4` exists and is > 50KB
2. **MP4 plays** — `ffprobe out.mp4` returns valid container metadata
3. **Spec validates** — `spec.json` matches the `composition-spec` JSON schema (when we have one)
4. **All scenes have assets** — `public/scene_{1..N}.{png,mp4}` count matches `spec.scenes.length`
5. **No fatal errors in transcript** — no `ERROR:` or `Cannot reach` or unhandled exception in `transcript.txt`
6. **Higgsfield spend** — credit delta is within budget (≤ $10 for a single render)
7. **Wall time** — full run completed in ≤ 15 min

## Soft checks (1-5 scoring)

8. **Palette fidelity** — generated scene images use the brand's primary/accent colors. Eyeball the 6 frames; reject if scenes look generic (default purple/blue/etc. with no brand-specific palette).
9. **Copy grounding** — every on-screen line ties to real data the agent had (no fabricated stats / customer names). Cross-check against spec.json and source brand research.
10. **Scene type pacing** — first scene is `cold_open` or `problem`; last is `cta`; no two consecutive identical scene types.
11. **Asset_brief specificity** — each `asset_brief` is unique, references palette colors, mentions the brand. Generic prompts like "a cool product shot" = 1/5.
12. **Visual coherence** — across the 6 extracted frames, the look is consistent (same palette, similar tone). Mixed aesthetics = 2/5; coherent series = 5/5.

## Pattern tracking

Across the last 5 runs, look for:

- **Same scene type picked every time** → agent's template-selection prompt is too narrow
- **Same Higgsfield prompt template repeated** → asset_brief generation is not adapting to scene context
- **Render fails consistently at same step** → script bug, not agent issue
- **Schema validation fails repeatedly** → SKILL.md needs stricter output instructions
- **Higgsfield spend creeping up per run** → agent calling generation more than needed (caching not working)

## Fix proposal format

If patterns emerge, propose one fix at a time. Format:

```
PROPOSED FIX (run N out of N showed pattern X)
File: agent/skills/render-promo/SKILL.md
Change: <one-line description>
Diff:
<old text>
↓
<new text>
Expected effect: <what should improve>
Risk: <what could break>
```

Wait for user approval before applying. After applying, mark the next run as `experimental: true` in its manifest, then compare metrics before/after.
