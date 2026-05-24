# Watchdog Review Prompt

This is what to invoke me with (manually or via `/loop`) to review captured runs.

## Manual invocation

Paste into Claude Code (this session or a fresh one rooted at the project):

```
You are the promo-agent watchdog. Review every run in
~/Desktop/Projects/Hackathons/promo-agent/watchdog/runs/
that has no review.md yet.

For each unreviewed run directory:

1. Read manifest.json
2. Read transcript.txt (focus on agent reasoning + tool calls; skip noise)
3. Read spec.json
4. Read frames/frame_{1..6}.png (use Read tool — they're real images)
5. Apply the rubric at watchdog/rubric.md
6. Write watchdog/runs/<id>/review.md with:
   - One-paragraph summary
   - Hard checks table (pass/fail)
   - Soft scores table (1-5)
   - Issues spotted (specific, file/line evidence if possible)
   - Comparison to prior 2-3 runs if available
   - Proposed fixes (rubric format) IF a pattern is emerging (≥3 runs with same issue)
7. Update the run's manifest.json — set "review_status" to "reviewed" with a one-line verdict

Then write a top-level findings file at watchdog/FINDINGS.md (overwrite each time):
- Total runs reviewed today
- Top 3 emerging patterns
- Top 3 proposed fixes (in priority order)
- Anything that warrants Dennis's attention immediately

Don't spend Higgsfield credits. Don't run the agent. Just review what's there.

When done, tell me: how many runs reviewed, top finding, recommended next action.
```

## Scheduled invocation

Add to your Claude Code `/loop`:

```
/loop 30m
You are the promo-agent watchdog. Review any new runs in
~/Desktop/Projects/Hackathons/promo-agent/watchdog/runs/
that have no review.md yet. Apply watchdog/rubric.md. Write reviews to each
run's review.md. Update watchdog/FINDINGS.md with patterns + proposed fixes.
Skip if no new runs since last tick. Don't spend credits. Don't run the agent.
```

Picks up new captures on each tick, reviews them, sleeps. You wake up to a folder of analyzed runs + a current FINDINGS.md.

## What I'll NOT do during a review

- Spend Higgsfield credits (per `feedback_hackathon_no_substitute_orchestrator`)
- Run the agent on my own to test a fix (you have to approve experiments)
- Apply a proposed fix without your sign-off
- Touch files outside `watchdog/` and `agent/skills/` (no scope creep)

## Workflow with the watchdog

1. You trigger an agent run via the dashboard (or `openclaw agent --session-id <id>`)
2. When the run finishes (or you think it's done), run:
   ```bash
   bash watchdog/scripts/capture_run.sh --label "trayd-v1"
   ```
   That snapshots logs + outputs + extracts frames.
3. Watchdog (me) wakes on next /loop tick, reviews the new capture, writes review.md.
4. Read FINDINGS.md for the headline. If a fix is proposed and you approve, I edit the skill + reinstall. Next run picks up the change.
5. Run again. The new review tells you if the fix helped.

That's the loop. 5-15 min of agent time per run + ~30 sec of watchdog time per review.
