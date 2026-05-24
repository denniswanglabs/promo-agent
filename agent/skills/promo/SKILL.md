---
name: promo
description: Use when asked to make/create/generate a promo video for a company URL.
---

# How to make a promo

You will use ONE tool: `openclaw:core:exec`. You will call it DIRECTLY as a tool invocation, NOT inside `tool_search_code`, NOT inside any JavaScript wrapper.

## Step 1 — kick off the render

Call `openclaw:core:exec` directly (not via tool_search_code) with these parameters:

```
tool: openclaw:core:exec
command: bash /sandbox/.openclaw/skills/promo/scripts/start_promo.sh <THE_URL> /sandbox/out.mp4
```

This command returns in under 2 seconds. It backgrounds the actual render. The response will say "STARTED" with an expected completion time.

## Step 2 — wait for the MP4 (poll once or twice)

After ~90 seconds, call `openclaw:core:exec` directly again with:

```
tool: openclaw:core:exec
command: bash /sandbox/.openclaw/skills/promo/scripts/wait_promo.sh 30
```

`wait_promo.sh` polls for up to 30 seconds and returns. If the response is `PENDING`, call it once more. If `DONE`, you have the MP4.

## Important

- DO NOT wrap `openclaw:core:exec` inside `tool_search_code`.
- DO NOT write JavaScript that calls `openclaw.tools.call(...)`.
- Call `openclaw:core:exec` directly as a top-level tool invocation.
- Each call returns in under 30 seconds — no JS sandbox timeout.
