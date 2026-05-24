---
name: promo
description: Use when asked to "make a promo video for <URL>", "create a promo for <company>", or any request to produce a promo MP4 from a company URL.
---

When asked to make a promo for a URL, call exactly ONE tool:

  openclaw:core:exec with command:
  bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh <THE_URL>

That command returns in 2-3 min with the output MP4 path. Report the path and file size. Do not call any other tools.
