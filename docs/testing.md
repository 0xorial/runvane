# Testing: running, logs, and diagnostics

## Running

- `npm test` — everything: backend unit → integration → e2e (`scripts/run-all-tests.mjs`).
  In the hive dev container it auto-wires the Linux-native binaries; on macOS it applies nothing.
- `npm run test:unit` / `npm run test:integration` / `npm run test:e2e` — one layer.
- All test layers run from **source** (`backend/src` via ts-node/ts-jest). `dist/` is never
  involved in tests — it exists only for distributing the app.
- Each suite gets an isolated, freshly migrated+seeded DB under `.e2e/` (`e2e.sqlite`,
  `integration.sqlite`). Tests can never touch a real DB: `bootstrap-app.ts` refuses any
  `DATABASE_URL` outside `.e2e/`.

## Logs — every run leaves a full log on disk

`scripts/test-diagnostics.mjs` is installed by both the e2e and integration runners.
**Read the log first when anything fails; never diagnose from theory.**

- `.e2e/logs/e2e-latest.log` and `.e2e/logs/integration-latest.log` — the complete
  output of the most recent run (plus a timestamped copy per run, same directory).
- What's in there:
  - **Harness + spec output** (Playwright/jest results, in order).
  - **Backend request log** (pino): every HTTP request with method, url, status,
    `responseTime` — the runners set `LOG_LEVEL=info` (override to `debug`/`silent`).
  - **Unhandled rejections / uncaught exceptions** with full stacks. These are logged
    and do NOT kill the run silently anymore (a background Prisma error used to take
    down the in-process backend and cascade 40+ specs into `ECONNREFUSED`).
  - **Event-loop lag samples** (`[diag] loop-lag …`) — distinguishes "JS was blocked"
    from "the DB/engine was stuck".
  - **Browser-side failures** (from `tests/e2e/fixtures.ts`): page JS errors, console
    errors/warnings, failed requests — tagged with the spec title. Normal SSE/asset
    teardown aborts are filtered out.
  - **Deep DB instrumentation** (`RUNVANE_DB_DIAG=1`, default for test runs):
    - `sql end@<t>ms dur=<d>ms | <statement>` — every statement slower than
      `RUNVANE_DB_DIAG_SLOW_MS` (default 100), incl. `BEGIN`/`COMMIT`. Set
      `RUNVANE_DB_DIAG_ALL=1` to log every statement.
    - `tx#N begin=…ms callback=…ms commit=…ms concurrentOpen=… steps=[…]` — every
      transaction's phase split and its internal statement timeline, on a shared
      clock so lines correlate.
    - Periodic Prisma pool metrics (`pool_open/busy/idle`, `q_wait`).

## The deadlock this instrumentation caught (July 2026)

Symptom: ~1 in 4 full e2e runs failed with `P1008 Socket timeout`, `P2010 "database is
locked"`, then a mass `ECONNREFUSED` cascade. It was **not** slow disk, not event-loop
starvation, not pool exhaustion (metrics showed idle connections and `q_wait=0`).

Root cause: a known Prisma query-engine deadlock with **concurrent interactive
transactions** ([prisma/prisma#11750](https://github.com/prisma/prisma/issues/11750),
[prisma-engines#2811](https://github.com/prisma/prisma-engines/pull/2811); still
reproducible on 6.19.3). The engine tracks open interactive transactions in a registry
behind an RwLock: committing takes a read lock, starting a new transaction takes a
write lock. Under concurrency, a queued start blocks a holder's commit while every
other transaction busy-waits in `BEGIN IMMEDIATE` on the SQLite write lock that stuck
commit holds. The engine freezes entirely (~5 s) until SQLite's `busy_timeout` aborts a
waiter. Measured signature: holder `commit=4810ms` with 6 ms of actual SQL; waiters
`BEGIN IMMEDIATE dur≈5034ms`; zero statements complete in the window; all commits burst
the instant one waiter times out.

Fix (`9446566`): **interactive transactions are banned on the chat-entries write path.**
All four `$transaction(async (tx) => …)` call sites became batch transactions
(`$transaction([...])`) — one atomic request that never entered the old engine's ITX
registry, so the deadlock could not form. The Rust engine (and with it that deadlock
class and the `RUNVANE_SQLITE_CONN_LIMIT` pool override) is gone since Prisma 7 —
queries run through the better-sqlite3 driver adapter — but the batch form stays as
the simpler shape (see the comment in
`backend/src/db/repositories/chat-entries-base.repo.ts`). `PrismaService` also enables
WAL + `busy_timeout=5000`.

## Zero-tolerance log gate

A run that passes every spec but leaves **any exception or warning in its log fails
anyway** (exit 1, with the offending lines printed). Enforced by
`enforceCleanExit()` in `scripts/test-diagnostics.mjs`, which scans every teed line
for: uncaught exceptions / unhandled rejections, browser page errors and console
errors/warnings, backend pino `error`/`fatal` lines, svelte compiler warnings, Node
`ExperimentalWarning`/`DeprecationWarning`, and `TypeError`/`ReferenceError`/etc.

Third-party noise that genuinely can't be fixed must be allowlisted **explicitly,
with a reason**, in `ALLOWLIST` in the same file (currently only Node's
`ExperimentalWarning` for `node:sqlite`, a deliberate rag-store dependency). Never
allowlist our own code's warnings — fix them at the source.

## Test-quality rules

- **No unstable tests.** A test that fails intermittently, or asserts environment-
  dependent values (pixel thresholds, wall-clock timing), is a defect — fix the test or
  the harness, don't re-run until green and don't loosen thresholds. Assert the
  behavior's invariant (e.g. "spacer grows when the viewport grows"), and verify a
  rewritten test still fails when the feature under test is disabled.
- A deterministic assertion mismatch is a code/WIP failure — never blame "flakiness"
  or contention without reading the run log.
