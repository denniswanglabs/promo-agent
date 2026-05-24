---
name: promo
description: Use when asked to make a promo video for a URL, create a promo for a company, render a brand video, or any request to produce a promo MP4 from a company URL. Examples - "make a promo for buildtrayd.com", "create a promo video for https://benchling.com", "video for kolr.ai", "render a kinetic promo for [company]".
---

# Promo — URL to MP4 in one shell call

When asked to make a promo video for a URL, call exactly ONE tool:

  openclaw:core:exec
  with command:
    bash /sandbox/.openclaw/skills/promo/scripts/make_promo.sh "<THE_URL>"

That script:
- Fetches the brand site
- Calls Nemotron to compose a CompositionSpec
- Renders a kinetic-typography MP4 via Remotion
- Returns in 2-3 minutes with the MP4 at /sandbox/out.mp4

Report:
- The output MP4 path
- The file size (run: `ls -lh /sandbox/out.mp4`)
- Any warnings from stderr

Do not call any other tools. Do not inspect the script before running it. Do not poll status during the run — the script runs synchronously and prints progress. The single openclaw:core:exec call will return when done (or with an error).

If the script fails, report the last 20 lines of its stderr to the user. Do not retry.
