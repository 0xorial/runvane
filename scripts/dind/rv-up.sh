#!/usr/bin/env bash
# Bring up the runvane dind dev environment on RUNVANE: two containers sharing
# the live /workspace but with SEPARATE DBs.
#   rv-dev    :52200/:52201  hot-reload of /workspace      DB backend.dev.sqlite (disposable)
#   rv-stable :52210/:52211  pinned snapshot, built once   DB backend.sqlite     (real data)
# Idempotent: rebuilds the image if missing, creates the pinned worktree if
# missing, and recreates both containers. Run on runvane (needs docker + git).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"        # this dir, in the repo
WORKTREE=/shared/rv-stable-src               # pinned snapshot checkout (off the share)
STABLE_DB=/workspace/backend/prisma/backend.sqlite
DEV_DB=/workspace/backend/prisma/backend.dev.sqlite

# 1. Image (built from this dir; Dockerfile.dev COPYs dev-entry.sh).
docker image inspect runvane-dev >/dev/null 2>&1 || docker build -t runvane-dev -f "$HERE/Dockerfile.dev" "$HERE"

# 2. Pinned worktree for rv-stable (detached at current main if absent).
[ -e "$WORKTREE" ] || git -C /workspace worktree add --detach "$WORKTREE" HEAD

# 3. Seed the dev DB from stable on first bring-up (rv-db-sync.sh refreshes later).
[ -f "$DEV_DB" ] || { echo "seeding $DEV_DB from stable"; sqlite3 "$STABLE_DB" ".backup '$DEV_DB'"; }

# 4. rv-dev — hot-reload, its own DB.
docker rm -f rv-dev >/dev/null 2>&1 || true
docker run -d --name rv-dev -p 52200:52200 -p 52201:52201 \
  -e BACKEND_PORT=52200 -e FRONTEND_PORT=52201 \
  -e FRONTEND_ORIGIN=http://localhost:52201 -e VITE_API_BASE_URL=http://localhost:52200 \
  -e DATABASE_URL="file:$DEV_DB" \
  -v /workspace:/workspace \
  -v rv-backend-nm:/workspace/backend/node_modules \
  -v rv-frontend-nm:/workspace/frontend/node_modules \
  -v "$HERE/dev-entry.sh":/usr/local/bin/dev-entry.sh \
  runvane-dev

# 5. rv-stable — pinned snapshot, real DB, built artifacts (entry mounted from this repo).
docker rm -f rv-stable >/dev/null 2>&1 || true
docker run -d --name rv-stable -p 52210:52210 -p 52211:52211 \
  -e BACKEND_PORT=52210 -e FRONTEND_PORT=52211 \
  -e FRONTEND_ORIGIN=http://localhost:52211 -e VITE_API_BASE_URL=http://localhost:52210 \
  -e DATABASE_URL=file:/dbdir/backend.sqlite \
  -v "$WORKTREE":/app -v /workspace/backend/prisma:/dbdir \
  -v rv-backend-nm-stable:/app/backend/node_modules \
  -v rv-frontend-nm-stable:/app/frontend/node_modules \
  -v "$HERE/dev-entry-stable.sh":/usr/local/bin/dev-entry-stable.sh \
  runvane-dev /usr/local/bin/dev-entry-stable.sh

echo "up: rv-dev :52200/:52201 (backend.dev.sqlite), rv-stable :52210/:52211 (backend.sqlite)"
echo "watch: docker logs -f rv-dev   /   docker logs -f rv-stable"
