#!/usr/bin/env bash
# ExecStart for the runvane harness unit on terra. The unit supplies the
# environment (EnvironmentFile=~/runvane.env of the `runvane` user) and runs
# this as that user. One process serves API and frontend on $PORT.
set -euo pipefail
APP_DIR="${RUNVANE_APP_DIR:-$HOME/app}"
[ -f "$APP_DIR/backend/dist/main.js" ] || { echo "start: no build at $APP_DIR/backend/dist — run scripts/terra/deploy.sh first" >&2; exit 1; }
cd "$APP_DIR/backend"
exec node dist/main.js
