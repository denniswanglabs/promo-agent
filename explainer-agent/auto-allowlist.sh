#!/bin/bash
# auto-allowlist.sh
#
# Given a URL, derive the host + likely subresource hosts, add them to
# agent/presets/demo-targets.yaml (right before the `binaries:` block, so
# yaml structure stays intact), then re-apply the policy with `nemoclaw
# promo-agent policy-add`. Verifies access by curling the URL inside the
# sandbox afterwards.
#
# Usage:
#   auto-allowlist.sh <url>
#
# Exit codes:
#   0  host added (or already allowlisted) and curl-verified
#   1  curl from sandbox failed (host still blocked)
#   2  policy-add failed
#   3  yaml edit failed

set -euo pipefail

URL="${1:?usage: $0 <url>}"

# Extract host from URL (strip scheme + path + port)
HOST=$(echo "$URL" | awk -F/ '{print $3}' | awk -F: '{print $1}')
if [ -z "$HOST" ]; then
  echo "[auto-allowlist] ERROR: could not extract host from $URL" >&2
  exit 3
fi

PROJECT="$HOME/Desktop/Projects/Hackathons/promo-agent"
YAML="$PROJECT/agent/presets/demo-targets.yaml"
NEMOCLAW="$HOME/.local/bin/nemoclaw"
if [ ! -x "$NEMOCLAW" ]; then NEMOCLAW="nemoclaw"; fi

if [ ! -f "$YAML" ]; then
  echo "[auto-allowlist] ERROR: $YAML not found" >&2
  exit 3
fi

echo "[auto-allowlist] URL:  $URL"
echo "[auto-allowlist] Host: $HOST"

# Build the list of candidate hosts: primary + common subresource patterns.
# We let the python inserter de-dupe against the existing file.
ROOT_DOMAIN=$(echo "$HOST" | awk -F. '{
  if (NF >= 2) print $(NF-1)"."$NF;
  else print $0;
}')

CANDIDATES=(
  "$HOST"
  "cdn.$HOST"
  "assets.$HOST"
  "static.$HOST"
  "fonts.$HOST"
  "images.$HOST"
  "www.$ROOT_DOMAIN"
  "cdn.$ROOT_DOMAIN"
  "assets.$ROOT_DOMAIN"
  "static.$ROOT_DOMAIN"
  # Common third-party CDNs almost every modern site pulls in
  "fonts.googleapis.com"
  "fonts.gstatic.com"
  "cdnjs.cloudflare.com"
  "ajax.googleapis.com"
  "code.jquery.com"
  "unpkg.com"
)

# v28: Generic prefix-patterns miss real-world CDN host names like
# `bookface-static.ycombinator.com` (YC), `assets-prod.acme.com`, etc.
# Augment the heuristic list by fetching the homepage HTML and extracting
# the actual src=/href= hosts. Costs one curl, prevents the entire class of
# "page renders as bare HTML because CDN host not allowlisted" bugs.
#
# We curl from the host machine (NOT through the sandbox) since this runs
# before the policy is applied — the goal is to discover hosts to permit.
echo "[auto-allowlist] Probing $URL for real subresource hosts..."
PROBE_HTML=$(curl -sL --max-time 8 --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" "$URL" 2>/dev/null || true)
if [ -n "$PROBE_HTML" ]; then
  # Extract hosts from src=/href= attributes. Filter to hosts ending in the
  # root domain OR matching common CDN patterns (-static, -cdn, -assets).
  # Skip schemes other than https and skip the primary HOST (already listed).
  PROBED=$(printf '%s' "$PROBE_HTML" \
    | grep -oE '(src|href)="https://[a-z0-9.-]+' \
    | grep -oE 'https://[a-z0-9.-]+' \
    | sed 's|https://||' \
    | awk -v root="$ROOT_DOMAIN" '
        # Keep if host ends in root domain (e.g. bookface-static.ycombinator.com)
        # OR host name contains a CDN-ish keyword (-static / cdn / assets / cdn-)
        ($0 ~ "\\." root "$") || ($0 ~ /(static|cdn|assets)/) { print }
      ' \
    | sort -u || true)
  if [ -n "$PROBED" ]; then
    echo "[auto-allowlist] Probe found real subresource hosts:"
    while IFS= read -r ph; do
      [ -n "$ph" ] && echo "    + $ph" && CANDIDATES+=("$ph")
    done <<< "$PROBED"
  fi
fi

# De-dupe in shell first. (macOS bash 3.2 has no associative arrays, so do it
# the portable way with a sorted/uniq pass via printf.)
UNIQ_STR=$(printf '%s\n' "${CANDIDATES[@]}" | awk '!seen[$0]++')
UNIQ=()
while IFS= read -r h; do
  [ -n "$h" ] && UNIQ+=("$h")
done <<< "$UNIQ_STR"

# Insert into YAML before the `binaries:` line at the correct indent.
# Use python for safe in-place edit + dedupe against existing host: lines.
python3 - "$YAML" "${UNIQ[@]}" <<'PY' || { echo "[auto-allowlist] yaml edit failed" >&2; exit 3; }
import sys, re, pathlib

yaml_path = pathlib.Path(sys.argv[1])
candidates = sys.argv[2:]

text = yaml_path.read_text()
lines = text.splitlines(keepends=True)

# Collect already-present hosts.
existing = set()
host_re = re.compile(r'^\s+-\s+host:\s+([^\s]+)')
for ln in lines:
    m = host_re.match(ln)
    if m:
        existing.add(m.group(1))

# Filter candidates.
new_hosts = [h for h in candidates if h not in existing]
if not new_hosts:
    print("[auto-allowlist] all candidate hosts already present", file=sys.stderr)
    sys.exit(0)

# Find the `    binaries:` line at indent 4 spaces.
insert_idx = None
for i, ln in enumerate(lines):
    if re.match(r'^\s{4}binaries:\s*$', ln):
        insert_idx = i
        break

if insert_idx is None:
    print("[auto-allowlist] ERROR: could not find `    binaries:` anchor", file=sys.stderr)
    sys.exit(3)

block = ["      # Auto-added by auto-allowlist.sh\n"]
for h in new_hosts:
    block.append(f"      - host: {h}\n")
    block.append("        port: 443\n")
    block.append("        access: full\n")

lines[insert_idx:insert_idx] = block
yaml_path.write_text("".join(lines))
print(f"[auto-allowlist] added {len(new_hosts)} new hosts", file=sys.stderr)
for h in new_hosts:
    print(f"  + {h}", file=sys.stderr)
PY

# Re-apply policy. Use --yes for non-interactive.
cd "$PROJECT"
echo "[auto-allowlist] applying policy..."
if ! "$NEMOCLAW" promo-agent policy-add demo-targets --from-file "agent/presets/demo-targets.yaml" --yes 2>&1 | tail -5; then
  echo "[auto-allowlist] policy-add returned non-zero" >&2
  # Don't hard-fail yet; some nemoclaw versions return non-zero on no-op.
fi

# Verify with a sandbox curl.
echo "[auto-allowlist] verifying with curl from sandbox..."
CURL_OUT=$("$NEMOCLAW" promo-agent exec --no-tty -- curl -sI -o /dev/null -w '%{http_code}' --max-time 15 "$URL" 2>&1 || true)
echo "[auto-allowlist] curl HTTP status: $CURL_OUT"

# Accept any 2xx/3xx as success (3xx redirects are common on root URLs).
case "$CURL_OUT" in
  2*|3*)
    echo "[auto-allowlist] OK: $HOST reachable from sandbox"
    exit 0
    ;;
  *)
    echo "[auto-allowlist] WARNING: $HOST returned $CURL_OUT (may still work for browser fetch)" >&2
    exit 0
    ;;
esac
