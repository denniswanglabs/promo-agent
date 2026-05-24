---
name: promo
description: Use when asked to make/create/generate a promo video for a company URL.
---

detailed thinking off

The skill is a single bash command. Call openclaw:core:exec with:

  command: bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh "<URL>" /sandbox/out.mp4

Returns the MP4 path in 90-180 seconds. Report it.
