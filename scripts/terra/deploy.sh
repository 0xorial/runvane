#!/usr/bin/env bash
# Build or refresh the runvane harness checkout on terra. Run as the `runvane`
# service user; idempotent, so re-running after a pull is the upgrade path.
#
#   scripts/terra/deploy.sh [ref]      ref: branch or tag, default main
#
# Needs on PATH: node >= 22 (with npm), git, ssh-keygen, and schema-engine from
# nixpkgs' prisma-engines (or PRISMA_SCHEMA_ENGINE_BINARY in the env file).
# Reads ~/runvane.env (RUNVANE_ENV_FILE); see runvane.env.example.
set -euo pipefail

APP_DIR="${RUNVANE_APP_DIR:-$HOME/app}"
ENV_FILE="${RUNVANE_ENV_FILE:-$HOME/runvane.env}"
REPO_URL="${RUNVANE_REPO_URL:-ssh://git@10.0.0.100:20022/timur.seitosmanov/runvane.git}"
REF="${1:-main}"

fail() { echo "deploy: $*" >&2; exit 1; }

command -v node >/dev/null || fail "node is not on PATH (need >= 22)"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "node $(node -v) is older than 22"
[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE (copy scripts/terra/runvane.env.example and edit)"
set -a; . "$ENV_FILE"; set +a
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set in $ENV_FILE"

# 1. Checkout at the requested ref (detached, so a redeploy never carries local edits).
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --quiet "$REPO_URL" "$APP_DIR"
fi
git -C "$APP_DIR" fetch --quiet --tags origin
if git -C "$APP_DIR" rev-parse --verify --quiet "origin/$REF" >/dev/null; then
  git -C "$APP_DIR" checkout --quiet --detach "origin/$REF"
else
  git -C "$APP_DIR" checkout --quiet --detach "$REF"
fi
echo "deploy: checkout $(git -C "$APP_DIR" rev-parse --short HEAD) ($REF)"

# 2. Dependencies and builds. The frontend is built for the backend's own
#    origin (empty API base); the backend compiles to backend/dist.
(cd "$APP_DIR/backend" && npm ci --no-audit --no-fund)
(cd "$APP_DIR/frontend" && npm ci --no-audit --no-fund && VITE_API_BASE_URL= npm run build)
(cd "$APP_DIR/backend" && npx nest build)

# 3. State directories and the database schema.
DB_PATH="${DATABASE_URL#file:}"
mkdir -p "$(dirname "$DB_PATH")" "${RUNVANE_SANDBOX_DATA_DIR:-$HOME/data/sandboxes}"
ENGINE="${PRISMA_SCHEMA_ENGINE_BINARY:-$(command -v schema-engine || true)}"
[ -n "$ENGINE" ] && [ -x "$ENGINE" ] || fail "schema-engine not found: add nixpkgs prisma-engines to PATH or set PRISMA_SCHEMA_ENGINE_BINARY"
(cd "$APP_DIR/backend" && PRISMA_SCHEMA_ENGINE_BINARY="$ENGINE" npx prisma migrate deploy)

# 4. The ssh key the harness presents to sandboxes (seats, the Mac).
KEY="$HOME/.ssh/id_ed25519"
if [ ! -f "$KEY" ]; then
  mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
  ssh-keygen -q -t ed25519 -N '' -f "$KEY" -C "runvane-harness@terra"
fi
echo "deploy: done. Harness public key (authorize it on each seat and on the Mac):"
cat "$KEY.pub"
echo "deploy: restart the service from the admin seat: systemctl restart runvane"
