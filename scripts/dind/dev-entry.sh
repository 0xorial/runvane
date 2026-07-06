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

install_deps backend true
install_deps frontend true

echo "=== launching backend :$BACKEND_PORT (nest start --watch) + frontend :$FRONTEND_PORT (vite) ==="

# Standard NestJS watch. On each rebuild @nestjs/cli kills the previous app via
# tree-kill and only respawns after it has exited, so :$BACKEND_PORT is released
# cleanly between reloads. tree-kill needs `ps` to find the app behind nest's
# `sh -c node …` wrapper — provided by procps in Dockerfile.dev. (Without `ps`
# it kills only the wrapper and the app orphans on the port → EADDRINUSE; that
# missing-`ps` bug, not nest itself, was the reason for the old split-loop here.)
( cd backend && PORT="$BACKEND_PORT" FRONTEND_ORIGIN="$FRONTEND_ORIGIN" \
    exec npx nest start --watch ) &
back=$!

( cd frontend && FRONTEND_PORT="$FRONTEND_PORT" VITE_API_BASE_URL="$VITE_API_BASE_URL" \
    exec npx vite --host 0.0.0.0 --port "$FRONTEND_PORT" ) &
front=$!

shutdown() { kill "$back" "$front" 2>/dev/null || true; }
trap shutdown TERM INT EXIT

# If either server exits, take the whole container down so it's an obvious failure.
wait -n
echo "=== a server process exited; stopping the container ==="
shutdown
