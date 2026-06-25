#!/usr/bin/env bash
# Entry point for the single runvane dev container.
#
# The live workspace is bind-mounted at /workspace, but backend/node_modules and
# frontend/node_modules are each shadowed by a container-local named volume. So:
#   - we run fresh Linux-native deps (Prisma engine, rolldown, lightningcss, …),
#     never the Mac's macOS binaries that sit in the share's node_modules;
#   - nothing Linux-native is ever written back onto the virtiofs share.
# First boot installs into the (empty) volumes; later boots reuse them.
set -euo pipefail

cd /workspace

prisma_gen() { ( cd backend && npx prisma generate ); }

# install_deps <dir> [post-install-cmd...]
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

echo "=== launching backend :$BACKEND_PORT (tsc --watch + node --watch) + frontend :$FRONTEND_PORT (vite) ==="

# Backend hot-reload, deliberately split into compile + run.
#
# We do NOT use `nest start --watch`: on each rebuild its restart spawns the server
# via an intermediate `sh -c "node dist/main"` and signals only that shell, so the
# node process is orphaned to PID 1, keeps holding :$BACKEND_PORT, and every later
# rebuild dies with EADDRINUSE while the stale (old-code) server keeps serving —
# i.e. code changes silently never take effect. Instead:
#   1) one clean `nest build` up front (deleteOutDir is safe with no watcher
#      running, same as rv-stable) so a complete, fresh dist exists before anything
#      tries to run it;
#   2) `tsc --watch` for incremental recompiles — unlike `nest build`, it does NOT
#      delete dist, so the running entrypoint never vanishes mid-flight (which would
#      wedge node --watch on the virtiofs share);
#   3) `node --watch` runs dist/main.js as a DIRECT child and restarts it itself, so
#      SIGTERM reaches node and :$BACKEND_PORT is released cleanly between reloads.
( cd backend && npm run build )

( cd backend && exec npx tsc -p tsconfig.build.json --watch --preserveWatchOutput ) &
back_build=$!

( cd backend && PORT="$BACKEND_PORT" FRONTEND_ORIGIN="$FRONTEND_ORIGIN" \
    exec node --watch --enable-source-maps dist/main.js ) &
back=$!

( cd frontend && FRONTEND_PORT="$FRONTEND_PORT" VITE_API_BASE_URL="$VITE_API_BASE_URL" \
    exec npx vite --host 0.0.0.0 --port "$FRONTEND_PORT" ) &
front=$!

shutdown() { kill "$back" "$back_build" "$front" 2>/dev/null || true; }
trap shutdown TERM INT EXIT

# If either server exits, take the whole container down so it's an obvious failure.
wait -n
echo "=== a server process exited; stopping the container ==="
shutdown
