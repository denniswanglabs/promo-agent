---
name: promo
description: Use when asked to "make a promo video for <URL>", "create a promo for <company>", or any request to produce a promo MP4 from a company URL.
---

A user request like "make a promo for https://example.com" maps to exactly one tool call:

```
openclaw:core:exec({"command": "bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh https://example.com /sandbox/out.mp4"})
```

Substitute the user's URL for https://example.com. Then report the MP4 path from the tool's stdout.

No other tools. No reasoning. No searching. The skill IS the plan.
