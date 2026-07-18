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

# Web tools (web_search/web_browse) reach the ai-browsing-enabler. In the dind,
# `localhost` is rv-dev itself, so point them at the enabler container and (below)
# join its network so the name resolves. Override either env to use a different
# deployment; if the enabler isn't running the tools fail with a clear ECONNREFUSED/
# ENOTFOUND naming this endpoint (no more "fetch failed").
ENABLER_NET=ai-browsing-enabler_egress
WEB_SEARCH_ENDPOINT="${RUNVANE_WEB_SEARCH_ENDPOINT:-http://ai-browsing-enabler-enabler-1:8080}"
WEB_BROWSE_ENDPOINT="${RUNVANE_WEB_BROWSE_ENDPOINT:-http://ai-browsing-enabler-enabler-1:3000}"

# 4. rv-dev — hot-reload, its own DB.
docker rm -f rv-dev >/dev/null 2>&1 || true
docker run -d --name rv-dev --restart unless-stopped -p 52200:52200 -p 52201:52201 \
  -e BACKEND_PORT=52200 -e FRONTEND_PORT=52201 \
  -e FRONTEND_ORIGIN=http://localhost:52201 -e VITE_API_BASE_URL=http://localhost:52200 \
  -e DATABASE_URL="file:$DEV_DB" \
  -e RUNVANE_WEB_SEARCH_ENDPOINT="$WEB_SEARCH_ENDPOINT" \
  -e RUNVANE_WEB_BROWSE_ENDPOINT="$WEB_BROWSE_ENDPOINT" \
  -v /workspace:/workspace \
  -v rv-backend-nm:/workspace/backend/node_modules \
  -v rv-frontend-nm:/workspace/frontend/node_modules \
  -v "$HERE/dev-entry.sh":/usr/local/bin/dev-entry.sh \
  -v /var/run/docker.sock:/var/run/docker.sock \
  runvane-dev

# 5. rv-stable — pinned snapshot, real DB, built artifacts (entry mounted from this repo).
docker rm -f rv-stable >/dev/null 2>&1 || true
docker run -d --name rv-stable --restart unless-stopped -p 52210:52210 -p 52211:52211 \
  -e BACKEND_PORT=52210 -e FRONTEND_PORT=52211 \
  -e FRONTEND_ORIGIN=http://localhost:52211 -e VITE_API_BASE_URL=http://localhost:52210 \
  -e DATABASE_URL=file:/dbdir/backend.sqlite \
  -e RUNVANE_WEB_SEARCH_ENDPOINT="$WEB_SEARCH_ENDPOINT" \
  -e RUNVANE_WEB_BROWSE_ENDPOINT="$WEB_BROWSE_ENDPOINT" \
  -v "$WORKTREE":/app -v /workspace/backend/prisma:/dbdir \
  -v rv-backend-nm-stable:/app/backend/node_modules \
  -v rv-frontend-nm-stable:/app/frontend/node_modules \
  -v "$HERE/dev-entry-stable.sh":/usr/local/bin/dev-entry-stable.sh \
  -v /var/run/docker.sock:/var/run/docker.sock \
  runvane-dev /usr/local/bin/dev-entry-stable.sh

# Join the enabler's network (if it's up) so the endpoint hostnames resolve —
# BOTH instances need it; rv-stable was forgotten originally, leaving its web
# tools pointing at localhost (i.e. itself).
if docker network inspect "$ENABLER_NET" >/dev/null 2>&1; then
  for c in rv-dev rv-stable; do
    docker network connect "$ENABLER_NET" "$c" 2>/dev/null || true
  done
  echo "wired rv-dev + rv-stable -> $ENABLER_NET (web_search/web_browse)"
else
  echo "note: enabler network $ENABLER_NET not found; web tools will error until it is up"
fi

echo "up: rv-dev :52200/:52201 (backend.dev.sqlite), rv-stable :52210/:52211 (backend.sqlite)"
echo "watch: docker logs -f rv-dev   /   docker logs -f rv-stable"
