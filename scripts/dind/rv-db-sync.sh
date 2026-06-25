#!/usr/bin/env bash
# Refresh the DEV database from the STABLE database. Run on RUNVANE.
#
# rv-stable owns the real data (backend.sqlite); rv-dev runs against a disposable
# copy (backend.dev.sqlite). This snapshots stable -> dev and re-applies the dev
# worktree's migrations, so you can test current code against fresh real data.
# rv-dev is briefly stopped so its DB file can be replaced cleanly.
set -euo pipefail

STABLE_DB=/workspace/backend/prisma/backend.sqlite
DEV_DB=/workspace/backend/prisma/backend.dev.sqlite

# Linux Prisma engines, kept off the virtiofs share (see runvane-prisma-linux-engine).
export PRISMA_QUERY_ENGINE_LIBRARY="${PRISMA_QUERY_ENGINE_LIBRARY:-/shared/.cache/runvane-prisma/libquery_engine-linux-arm64-openssl-3.0.x.so.node}"
export PRISMA_SCHEMA_ENGINE_BINARY="${PRISMA_SCHEMA_ENGINE_BINARY:-/shared/.cache/runvane-prisma/schema-engine-linux-arm64-openssl-3.0.x}"

[ -f "$STABLE_DB" ] || { echo "stable DB missing: $STABLE_DB" >&2; exit 1; }

echo "[1/4] stop rv-dev (release its DB file)"
docker stop rv-dev >/dev/null 2>&1 || true

echo "[2/4] consistent online copy: stable -> dev"
rm -f "$DEV_DB" "$DEV_DB-journal" "$DEV_DB-wal" "$DEV_DB-shm"
# sqlite3 .backup uses the SQLite online-backup API: safe even while rv-stable writes.
sqlite3 "$STABLE_DB" ".backup '$DEV_DB'"

echo "[3/4] apply dev worktree migrations to the dev DB"
( cd /workspace/backend && DATABASE_URL="file:$DEV_DB" npx prisma migrate deploy )

echo "[4/4] start rv-dev on the fresh dev DB"
docker start rv-dev >/dev/null
echo "done — dev DB refreshed from stable ($(du -h "$DEV_DB" 2>/dev/null | cut -f1)). Watch: docker logs -f rv-dev"
