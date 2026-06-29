# Runvane dind dev environment

Runs the app inside the in-container Docker daemon (the "dind") as **two
parallel containers** that mount the live `/workspace` but use **separate
databases**:

| Container | Ports | Code | Reload | Database |
|-----------|-------|------|--------|----------|
| `rv-dev` | 52200 / 52201 | live `/workspace` | `nest --watch` + vite (hot) | `backend/prisma/backend.dev.sqlite` (disposable) |
| `rv-stable` | 52210 / 52211 | pinned worktree `/shared/rv-stable-src` | built once (`node dist/main` + `vite preview`) | `backend/prisma/backend.sqlite` (real data) |

Both run from one image (`runvane-dev`), with `backend/` and `frontend/`
`node_modules` shadowed by container-local named volumes so the Mac's
macOS-native binaries on the virtiofs share are never used (and no Linux
binaries leak back onto the share).

## Files

- `Dockerfile.dev` / `dev-entry.sh` — the image and rv-dev's entrypoint (`npm ci` into the shadow volumes, then `nest start --watch` + vite). The image installs **`procps`**, which `nest start --watch` needs to restart cleanly (see the caveat below).
- `dev-entry-stable.sh` — rv-stable's entrypoint: builds (`nest build` + `vite build`) then serves `node dist/main` + `vite preview`. Mounted in at run time.
- `rv-up.sh` — bring up / recreate both containers (idempotent: builds image, creates the pinned worktree, seeds the dev DB if missing).
- `rv-db-sync.sh` — refresh the dev DB from the stable DB (online `sqlite3 .backup` + `prisma migrate deploy`).
- `rv-stable-update.sh [ref]` — re-pin the stable snapshot to `ref` (default `main`) and rebuild it.

All scripts run **on runvane** (they drive the dind via `docker` + `git`).

## Usage

```sh
# build image + start both containers (first run also seeds the dev DB)
scripts/dind/rv-up.sh

# point the dev instance at a fresh copy of stable's real data, upgraded to
# the current worktree's schema (do this after adding a migration, or anytime)
scripts/dind/rv-db-sync.sh

# move the stable instance to a new commit and rebuild it
scripts/dind/rv-stable-update.sh           # -> current main
scripts/dind/rv-stable-update.sh <commit>  # -> a specific ref
```

## Notes / caveats

- **Mac reachability:** the dind publishes ports on runvane's `0.0.0.0`, but the
  Mac browser can only reach a port once runvane's uplink/hive forwards it to
  the host (set at container start, curated outside the container). 52200/52201
  are already forwarded; add **52210/52211** to reach rv-stable.
- **Prisma engines** for the sync's `migrate deploy` come from
  `/shared/.cache/runvane-prisma` (Linux builds kept off the virtiofs share);
  `rv-db-sync.sh` exports the paths.
- **Separate DBs** were chosen over a shared file to avoid two-writer
  `SQLITE_BUSY`/virtiofs-locking issues; `rv-db-sync.sh` is the bridge between them.
- **`procps` is required in the image.** `@nestjs/cli`'s `--watch` restart kills
  the previous app via `tree-kill`, which shells out to `ps -A -o pid,ppid` to find
  the node process behind nest's `sh -c node …` wrapper. The slim base ships no
  `ps`; without it tree-kill kills only the wrapper, the node app **orphans holding
  the backend port**, and every reload hits **EADDRINUSE** while stale code keeps
  serving. `Dockerfile.dev` installs `procps` to fix this — **rebuild the image**
  (not just `docker restart`) after pulling this change so it survives a recreate.
  (This is the real cause of the symptom an earlier `tsc --watch` + `node --watch`
  split-loop was working around; that workaround has been removed.)
- This is dev tooling specific to the in-container dind, not a production deploy
  (see `deploy.md` for ops hardening).
