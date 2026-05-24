---
name: promo
description: Use when asked to make/create/generate a promo video for a company URL.
---

You have access to the openclaw:core:exec tool. When a user asks for a promo:

1. Extract the URL from their message.
2. Call openclaw:core:exec with this exact command, substituting THE_URL:
   bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh THE_URL /sandbox/out.mp4
3. The tool returns in 90-180 seconds. Its last line is "DONE: /sandbox/out.mp4 (size)".
4. Report that line back to the user.

That is the complete procedure. There is no step zero. There is no exploration phase.
