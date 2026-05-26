#!/usr/bin/env python3
"""
Explainer Agent dashboard sidecar.

Flask app on 127.0.0.1:8082 that lets a judge (or Dennis at the booth) type a
URL + goal, spawns tutorial-maker.sh, surfaces live progress, and serves the
final MP4. No Claude in the live-demo path.

The static observability dashboard on :8081 keeps running untouched; we embed
its grid.html in an iframe on the status page.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
import time
import uuid
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from flask import (
    Flask,
    abort,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    url_for,
)

# ---------------------------------------------------------------------------
# Paths.
# ---------------------------------------------------------------------------

HOME = Path.home()
PROJECT_DIR = HOME / "Desktop" / "Projects" / "Hackathons" / "promo-agent"
TUTORIAL_MAKER = PROJECT_DIR / "tutorial-maker.sh"

JOBS_DIR = Path("/tmp/dashboard-jobs")
JOBS_DIR.mkdir(parents=True, exist_ok=True)

# In-memory job registry. Survives process lifetime; rebuilt from disk on
# restart so the status pages still work for completed jobs.
_JOBS: dict[str, dict] = {}


def _job_log(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.log"


def _job_meta(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def _job_mp4(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.mp4"


def _load_meta(job_id: str) -> Optional[dict]:
    """Best-effort load of job metadata from disk."""
    if job_id in _JOBS:
        return _JOBS[job_id]
    meta_path = _job_meta(job_id)
    if meta_path.exists():
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            _JOBS[job_id] = meta
            return meta
        except (json.JSONDecodeError, OSError):
            return None
    return None


def _save_meta(job_id: str, meta: dict) -> None:
    _JOBS[job_id] = meta
    try:
        with open(_job_meta(job_id), "w") as f:
            json.dump(meta, f)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Validation.
# ---------------------------------------------------------------------------

_JOB_ID_RE = re.compile(r"^[a-f0-9]{8,32}$")


def _is_valid_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _is_valid_job_id(job_id: str) -> bool:
    return bool(_JOB_ID_RE.match(job_id))


# ---------------------------------------------------------------------------
# Phase inference from log lines.
# ---------------------------------------------------------------------------

# Markers come from tutorial-maker.sh's own echo lines.
PHASE_MARKERS = [
    ("done", re.compile(r"\[tutorial-maker\] DONE")),
    ("rendering", re.compile(r"Step 4/4")),
    ("rendering", re.compile(r"Step 3/4")),  # replay is part of render
    ("recording", re.compile(r"Step 2/4")),
    ("discovering", re.compile(r"Step 1/4")),
]


PHASE_LABELS = {
    "queued": "Queued",
    "discovering": "Discovering (auto-allowlist)",
    "recording": "Recording (NemoClaw scouts)",
    "rendering": "Rendering (replay + overlay)",
    "done": "Done",
    "failed": "Failed",
}


def _infer_phase(log_text: str, mp4_exists: bool, proc_alive: bool) -> str:
    if mp4_exists and not proc_alive:
        return "done"
    if not log_text.strip():
        return "queued"
    for phase, pat in PHASE_MARKERS:
        if pat.search(log_text):
            return phase
    return "queued"


def _tail_lines(path: Path, n: int) -> list[str]:
    if not path.exists():
        return []
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            # Read up to ~32KB from the tail; enough for n lines unless lines
            # are pathological.
            chunk = min(size, 32 * 1024)
            f.seek(size - chunk)
            tail = f.read().decode("utf-8", errors="replace")
        lines = tail.splitlines()
        return lines[-n:]
    except OSError:
        return []


# ---------------------------------------------------------------------------
# Flask app.
# ---------------------------------------------------------------------------

app = Flask(__name__)


@app.route("/")
def index():
    return render_template("input.html")


@app.route("/run", methods=["POST"])
def run_job():
    url = (request.form.get("url") or "").strip()
    goal = (request.form.get("goal") or "").strip()

    if not url or not goal:
        return ("Missing url or goal.", 400)
    if not _is_valid_url(url):
        return ("Invalid URL (must be http/https).", 400)
    if len(url) > 2000 or len(goal) > 2000:
        return ("Input too long.", 400)

    if not TUTORIAL_MAKER.exists():
        return (
            f"tutorial-maker.sh not found at {TUTORIAL_MAKER}.",
            500,
        )

    job_id = uuid.uuid4().hex[:12]
    log_path = _job_log(job_id)
    mp4_path = _job_mp4(job_id)

    # Spawn tutorial-maker.sh with the MP4 path baked in via $3 — no patch
    # needed to the script itself.
    cmd = [
        "bash",
        str(TUTORIAL_MAKER),
        url,
        goal,
        str(mp4_path),
    ]

    log_fh = open(log_path, "wb")
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(PROJECT_DIR),
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except OSError as e:
        log_fh.close()
        return (f"Failed to spawn tutorial-maker: {e}", 500)

    meta = {
        "job_id": job_id,
        "url": url,
        "goal": goal,
        "pid": proc.pid,
        "started_at": time.time(),
        "cmd": " ".join(shlex.quote(c) for c in cmd),
        "mp4": str(mp4_path),
        "log": str(log_path),
    }
    _save_meta(job_id, meta)

    return redirect(url_for("status_page", job_id=job_id))


@app.route("/status/<job_id>")
def status_page(job_id: str):
    if not _is_valid_job_id(job_id):
        abort(404)
    meta = _load_meta(job_id)
    if meta is None:
        abort(404)
    return render_template("status.html", job_id=job_id, meta=meta)


@app.route("/api/status/<job_id>")
def api_status(job_id: str):
    if not _is_valid_job_id(job_id):
        return jsonify({"phase": "not_found"}), 404
    meta = _load_meta(job_id)
    if meta is None:
        return jsonify({"phase": "not_found"}), 404

    log_path = _job_log(job_id)
    mp4_path = _job_mp4(job_id)
    mp4_exists = mp4_path.exists() and mp4_path.stat().st_size > 0

    pid = meta.get("pid")
    proc_alive = False
    if pid:
        try:
            # waitpid(WNOHANG) reaps zombies of children we spawned (so they
            # don't linger as <defunct>) AND tells us if the process is gone.
            wpid, _ = os.waitpid(pid, os.WNOHANG)
            if wpid == 0:
                # Still running.
                proc_alive = True
            # else: reaped → not alive.
        except ChildProcessError:
            # Not a child of this Flask process (e.g. process restarted) —
            # fall back to kill(0).
            try:
                os.kill(pid, 0)
                proc_alive = True
            except ProcessLookupError:
                proc_alive = False
            except PermissionError:
                proc_alive = True

    # Read tail for phase inference + UI display.
    tail_lines = _tail_lines(log_path, 100)
    log_text = "\n".join(tail_lines)
    phase = _infer_phase(log_text, mp4_exists, proc_alive)

    # Detect explicit failure: process exited without producing the mp4.
    if not proc_alive and not mp4_exists and tail_lines:
        # Walk backwards for FAILED markers.
        joined = log_text.lower()
        if (
            "failed" in joined
            or "exit code" in joined
            or "[tutorial-maker] failed" in joined
        ):
            phase = "failed"
        elif phase != "done":
            # Process died but no mp4 and no DONE marker → failed.
            phase = "failed"

    started_at = float(meta.get("started_at") or time.time())
    elapsed_sec = max(0, int(time.time() - started_at))

    return jsonify(
        {
            "job_id": job_id,
            "phase": phase,
            "phase_label": PHASE_LABELS.get(phase, phase),
            "elapsed_sec": elapsed_sec,
            "proc_alive": proc_alive,
            "mp4_exists": mp4_exists,
            "last_log_lines": tail_lines[-20:] if phase == "failed" else tail_lines[-5:],
            "output_mp4": (
                url_for("api_result", job_id=job_id) if mp4_exists else None
            ),
            "url": meta.get("url"),
            "goal": meta.get("goal"),
        }
    )


@app.route("/api/result/<job_id>")
def api_result(job_id: str):
    if not _is_valid_job_id(job_id):
        abort(404)
    mp4_path = _job_mp4(job_id)
    if not mp4_path.exists() or mp4_path.stat().st_size == 0:
        abort(404)
    return send_file(
        str(mp4_path),
        mimetype="video/mp4",
        as_attachment=True,
        download_name=f"explainer-{job_id}.mp4",
    )


@app.route("/api/health")
def api_health():
    return jsonify({"ok": True, "tutorial_maker": TUTORIAL_MAKER.exists()})


# ---------------------------------------------------------------------------
# Entry point.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Bind localhost-only. No auth.
    print("Explainer Agent dashboard → http://127.0.0.1:8082")
    print(f"  tutorial-maker: {TUTORIAL_MAKER}")
    print(f"  jobs dir:       {JOBS_DIR}")
    app.run(host="127.0.0.1", port=8082, debug=False, use_reloader=False)
