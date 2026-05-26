# Explainer Agent dashboard

Flask sidecar on `127.0.0.1:8082`. A judge (or Dennis at the booth) types a
URL + goal, the page spawns `tutorial-maker.sh`, surfaces live progress, and
serves the final MP4. No Claude in the live-demo path.

## Start

    pip install flask
    python server.py

Or, equivalently:

    bash launch.sh

Then open `http://127.0.0.1:8082`.

## Notes

- The existing static dashboard on `:8081` (grid.html) keeps running — this
  sidecar embeds it in an iframe on the status page.
- Job state lives under `/tmp/dashboard-jobs/<job_id>.{log,json,mp4}`.
- Output MP4 path is passed to `tutorial-maker.sh` as `$3`; the script is not
  patched.
