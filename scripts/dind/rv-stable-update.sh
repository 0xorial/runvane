#!/usr/bin/env bash
# Re-pin and rebuild the rv-stable snapshot. Run on RUNVANE (needs git + docker).
# Usage: rv-stable-update.sh [<git-ref>]      # default ref: main
#
# Checks out <ref> in the pinned worktree, forces a dep reinstall only if a
# package-lock changed, then restarts rv-stable (its entry rebuilds + serves).
set -euo pipefail

WORKTREE=/shared/rv-stable-src
REF="${1:-main}"

lock_hash() { sha1sum "$1" 2>/dev/null | awk '{print $1}'; }
drop_sentinel() { # $1 = volume name
  docker run --rm --entrypoint rm -v "$1":/nm runvane-dev -f /nm/.rv-installed 2>/dev/null || true
}

echo "=== fetch + checkout $REF in $WORKTREE ==="
git -C /workspace fetch --all --quiet 2>/dev/null || true
old_be=$(lock_hash "$WORKTREE/backend/package-lock.json")
old_fe=$(lock_hash "$WORKTREE/frontend/package-lock.json")

git -C "$WORKTREE" checkout --detach "$REF"

[ "$(lock_hash "$WORKTREE/backend/package-lock.json")"  != "$old_be" ] && { echo "backend deps changed -> reinstall"; drop_sentinel rv-backend-nm-stable; }
[ "$(lock_hash "$WORKTREE/frontend/package-lock.json")" != "$old_fe" ] && { echo "frontend deps changed -> reinstall"; drop_sentinel rv-frontend-nm-stable; }

echo "=== restart rv-stable (rebuilds snapshot from $REF) ==="
docker restart rv-stable
echo "=== done. follow build: docker logs -f rv-stable ==="
