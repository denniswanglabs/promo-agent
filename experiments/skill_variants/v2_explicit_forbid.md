---
name: promo
description: Use when asked to "make a promo video for <URL>", "create a promo for <company>", or any request to produce a promo MP4 from a company URL.
---

To make a promo, immediately invoke:

  tool_name: openclaw:core:exec
  command: bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh "<THE_URL>"

DO NOT call tool_search_code. DO NOT explore. DO NOT plan. The skill above IS the plan.

After openclaw:core:exec returns (2-3 minutes), report the MP4 path and file size from its stdout.
