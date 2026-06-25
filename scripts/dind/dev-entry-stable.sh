#!/usr/bin/env bash
# Entry point for the rv-stable instance: a FROZEN snapshot of the repo, built
# once and served from built artifacts (no watch). It shares the live SQLite DB
# with rv-dev. Code lives in a pinned git worktree bind-mounted at /app; the DB
# directory is bind-mounted at /dbdir. Sibling of dev-entry.sh — see
# [[runvane-dind-dev-run]].
set -euo pipefail

cd /app

prisma_gen() { ( cd backend && npx prisma generate ); }

# install_deps <dir> [post-install-cmd...] — fresh Linux deps into the shadow
# volume (its own, separate from rv-dev's), guarded by a sentinel.
install_deps() {
  local dir="$1"; shift
  if [ ! -f "$dir/node_modules/.rv-installed" ]; then
    echo "=== $dir: npm ci (fresh Linux deps into shadow volume) ==="
    ( cd "$dir" && npm ci )
    "$@"
    touch "$dir/node_modules/.rv-installed"
  else
    echo "=== $dir: deps already present in volume, skipping install ==="
  fi
}

install_deps backend prisma_gen
install_deps frontend true

# Build the snapshot. No watcher runs here, so nest build's clean step is safe,
# and /app lives on the /shared volume (not virtiofs) so there's no unlink race.
echo "=== building snapshot: backend (nest build) + frontend (vite build) ==="
( cd backend  && npm run build )
( cd frontend && VITE_API_BASE_URL="$VITE_API_BASE_URL" npx vite build )

echo "=== launching stable backend :$BACKEND_PORT (node dist/main) + frontend :$FRONTEND_PORT (vite preview) ==="
( cd backend  && PORT="$BACKEND_PORT" FRONTEND_ORIGIN="$FRONTEND_ORIGIN" \
    exec node dist/main ) &
back=$!

( cd frontend && exec npx vite preview --host 0.0.0.0 --port "$FRONTEND_PORT" ) &
front=$!

shutdown() { kill "$back" "$front" 2>/dev/null || true; }
trap shutdown TERM INT EXIT

# If either server exits, take the whole container down so it's an obvious failure.
wait -n
echo "=== a server process exited; stopping the container ==="
shutdown
