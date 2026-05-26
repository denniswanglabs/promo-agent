#!/usr/bin/env bash
# launch.sh — start the Explainer Agent dashboard on 127.0.0.1:8082.
#
# Installs Flask in the active Python if missing, then runs server.py.
# Does NOT touch the existing static observe-host server on :8081.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PY="${PYTHON:-python3}"

if ! "$PY" -c "import flask" >/dev/null 2>&1; then
  echo "[launch] Installing Flask into $($PY -c 'import sys; print(sys.executable)')"
  # --break-system-packages: required on Homebrew/PEP-668 Pythons. Safe here
  # because this is a dev tool on Dennis's laptop, not a system service.
  "$PY" -m pip install --quiet --user --break-system-packages flask \
    || "$PY" -m pip install --quiet --user flask
fi

# Sanity: make sure 8082 is free.
if lsof -iTCP:8082 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[launch] Port 8082 already in use. Aborting." >&2
  lsof -iTCP:8082 -sTCP:LISTEN >&2 || true
  exit 1
fi

echo "[launch] Starting Explainer Agent dashboard on http://127.0.0.1:8082"
exec "$PY" server.py
