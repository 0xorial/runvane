# Layer X — Testing & dev-infra doctrine

This is cross-cutting rather than a single altitude: the testing rules *enforce*
Layer 0 (surface errors) and Layer 1 (validated boundaries) at the process level,
and they encode hard-won lessons about this specific runtime. Treat it as a peer of
the philosophy doc, aimed at contributors.

Sources: `docs/testing.md`, `scripts/run-all-tests.mjs`, `scripts/run-e2e.mjs`,
`scripts/e2e-servers.mjs`, `scripts/test-diagnostics.mjs`,
`tests/e2e/*`, `tests/integration/support/bootstrap-app.ts`,
`backend/src/llmProviders/providers/stubLlm.ts`.

---

## The layers, and "everything runs from source"

`npm test` runs unit → integration → e2e (`package.json:13`,
`scripts/run-all-tests.mjs`). Every layer runs from **`backend/src` via
ts-node/ts-jest** — `dist/` is *never* involved in tests; it exists only to
distribute the app (`docs/testing.md:6-9`). The e2e backend even loads TS source
through `scripts/backend-src.mjs`. This is a deliberate rule with its own memory
note: *dist is for distribution only; all tests run from src.*

Prefer **e2e** for features; unit tests are the exception, reserved for genuinely
complex isolated logic (project preference, and visible in the ratio: 20+ e2e
specs, a handful of targeted unit specs like the syntax dialects and provider-cost).

## Tests can never touch a real DB

Each layer gets a freshly migrated+seeded, disposable SQLite under `.e2e/`
(`e2e.sqlite`, `integration.sqlite`). The bootstrap **refuses** any `DATABASE_URL`
outside `.e2e/` — no silent fallback:

```ts
// tests/integration/support/bootstrap-app.ts:29-35
if (!databaseUrl || !databaseUrl.includes('/.e2e/')) {
  throw new Error(`createTestApp: refusing to run against DATABASE_URL=… ` +
    'Integration tests require an isolated DB under .e2e/');
}
```

The comment records the incident that motivated it: an unset/ambient
`DATABASE_URL` "used to silently open a real DB and let tests write into it." §0.1
turned into a guardrail.

## The stub LLM: real pipeline, deterministic model

Tests exercise the **actual** thought pipeline, SSE, DB and tools — only the model
is swapped for `StubLlmProvider`, which implements the same `LlmProvider` interface
plus a scripting control (`stubLlm.ts`, `stubLlm.control.ts`). It's wired only in
`test` + `stub` mode via `TestHarnessModule` (`app.module.ts:51`, `:85`), so
production can't expose it. This is why the tests are meaningful: they prove the
orchestration, not a mock of it.

## Every run leaves a full log — read it before theorizing

Both runners install `scripts/test-diagnostics.mjs`, which tees everything to
`.e2e/logs/{e2e,integration}-latest.log`: Playwright/jest output, the pino request
log (method/url/status/`responseTime`), unhandled rejections with full stacks,
event-loop lag samples, browser-side page/console errors, and — under
`RUNVANE_DB_DIAG=1` (default for tests) — per-statement and per-transaction timing
with concurrency. The standing rule (and a memory note): **read the log first when
anything fails; never diagnose from theory** (`docs/testing.md:14-40`).

This instrumentation is not decoration — it's what caught the Prisma interactive-
transaction deadlock (`docs/testing.md:42-69`), whose fix is documented in
[mechanisms → batch transactions](10-mechanisms-reference.md#batch-transactions).

## The zero-tolerance log gate

The signature rule: **a run that passes every assertion but leaves any exception or
warning in its log fails anyway** (exit 1, offending lines printed). Enforced by
`enforceCleanExit()` scanning every teed line for uncaught exceptions/rejections,
browser page/console errors, pino `error`/`fatal`, svelte compiler warnings, Node
`Experimental`/`Deprecation` warnings, and `TypeError`/`ReferenceError`
(`docs/testing.md:71-82`, `scripts/test-diagnostics.mjs:43-59`).

Third-party noise that truly can't be fixed is allowlisted **explicitly, with a
reason** — currently one entry, Node's `ExperimentalWarning` for `node:sqlite`
(`test-diagnostics.mjs:43-46`). "Never allowlist our own code's warnings — fix them
at the source." This is §0.1 as a CI contract: a warning is a defect until proven
otherwise.

## No unstable tests, ever

`docs/testing.md:84-92` is categorical: a test that fails intermittently, or
asserts environment-dependent values (pixel thresholds, wall-clock timing), is a
**defect** — fix the test/harness, don't re-run until green and don't loosen
thresholds. Assert the invariant ("spacer grows when the viewport grows"), and
verify the rewritten test still fails when the feature is disabled. "A
deterministic assertion mismatch is a code/WIP failure — never blame 'flakiness'
without reading the run log." (A resolved case where "flakiness" was really two
deterministic stub-matcher bugs + one real race is on record.)

## E2e harness shape

Playwright with page objects (`tests/e2e/pages/RunvaneApp.ts`, `ChatPage.ts`,
`ChatTranscript.ts`, `Sidebar.ts`, `UserInput.ts`) and a `test` fixture that pipes
browser `pageerror`/`console.error`/`requestfailed` into the run log (filtering
only the normal SSE/asset teardown aborts) — `tests/e2e/fixtures.ts:11-59`. An auto
fixture drains `/api/tasks` after each test so a leaked in-flight LLM/tool task
fails the test rather than bleeding into the next (`fixtures.ts:38-58`).

## Dev-ports: deterministic, collision-free ports

Each project gets a 3-digit base × 100 ports (`dev-ports/README.md`): runvane is
`522` → dev backend `52200`, frontend `52201`; e2e uses base `523` → `52300`
(`scripts/e2e-servers.mjs:9-14`). Ports are config, resolved once and injected as
env (`FRONTEND_ORIGIN`, `PORT`) — the backend *throws* if they're unset rather than
guessing (`bootstrap.ts:37-44`), §0.1 again.

## What it forbids

- Running tests from `dist/`.
- Any test DB outside `.e2e/`.
- Merging a run with warnings/exceptions in the log (unless explicitly, reasonedly
  allowlisted).
- "Fixing" a flaky test by re-running or loosening a threshold.
- Diagnosing a failure from theory before reading `.e2e/logs/…-latest.log`.
