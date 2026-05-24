#!/usr/bin/env bash
# Watchdog one-time setup.
# Mounts the sandbox filesystem under watchdog/sandbox-mount/ via SSHFS,
# so the host can read /sandbox/out.mp4, /sandbox/spec.json, etc. directly.

set -euo pipefail

WATCHDOG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MOUNT_POINT="$WATCHDOG_DIR/sandbox-mount"

mkdir -p "$MOUNT_POINT"

# Check if already mounted
if mount | grep -q " $MOUNT_POINT "; then
  echo "Sandbox already mounted at $MOUNT_POINT"
  exit 0
fi

# Check sshfs presence
if ! command -v sshfs >/dev/null 2>&1; then
  echo "ERROR: sshfs not installed on host." >&2
  echo "Install via: brew install --cask macfuse && brew install gromgit/fuse/sshfs-mac" >&2
  exit 1
fi

echo "Mounting sandbox at $MOUNT_POINT ..."
nemoclaw promo-agent share mount /sandbox "$MOUNT_POINT"

ls -la "$MOUNT_POINT" | head -10
echo "Mount ready."
