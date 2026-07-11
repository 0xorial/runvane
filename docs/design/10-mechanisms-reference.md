# Layer 4 — Mechanisms reference

The small, local, load-bearing tricks the higher layers lean on. Each is an
instance of a Layer-0/1 conviction; this doc is a quick lookup with the "why" and
the source. If a higher-level doc says "see mechanisms," it points here.

---

## <a id="stream-cursor"></a>The stream cursor / watermark

**What.** A single-row table `stream_cursor (id=0, value)` bumped **in the same
transaction as every `chat_entries` mutation**. Its value is simultaneously the SSE
event `seq` and the snapshot watermark.
**Why.** One monotonic number does the entire snapshot↔live-tail handoff with no
replay buffer and no seq negotiation (Layer 3 — SSE).
**Where.** `schema.prisma:161-170`; in-memory mirror `db/stream-cursor.service.ts`;
consumed `sse/sse-hub.service.ts:30-43`, `conversations.controller.ts:274-311`.
**Subtlety.** Live events read the cheap in-memory mirror; the snapshot reads the DB
cursor *inside the entries' own read txn* so its watermark exactly matches the rows
returned.

## <a id="batch-transactions"></a>Batch transactions (never interactive) on the write path

**What.** All chat-entry writes use Prisma **batch** transactions
(`$transaction([...])`), never interactive (`$transaction(async (tx) => …)`).
**Why.** A known Prisma query-engine deadlock: concurrent interactive transactions
serialized on an RwLock in the engine's ITX registry, freezing ~5s until SQLite's
`busy_timeout` aborted a waiter. Symptom was ~1-in-4 e2e runs failing with `P1008`/
`P2010` then an `ECONNREFUSED` cascade.
**Where.** Rule + rationale `db/repositories/chat-entries-base.repo.ts:28-36`; call
sites `:107`, `:229`, `:341`, `:465`; full write-up `docs/testing.md:42-69`.
**Status.** The Rust engine (and that deadlock class) is **gone since Prisma 7**
(better-sqlite3 driver adapter); the batch form stays as the simpler shape.
`PrismaService` also enables WAL + `busy_timeout=5000`.
**Memory note.** Engine-free since 2026-07-06; the generated client is committed
in-tree; stale `PRISMA_*ENGINE*` env vars break the v7 CLI.

## <a id="side-lane"></a>The side lane (`is_side`)

**What.** A boolean on every entry marking bookkeeping thoughts (title, categorize,
attachment-summary, tool-params, guardrail) that display against a spine entry but
are excluded from branch semantics.
**Why.** Lets any number of them run concurrently against the same anchor without
ever forking the conversation.
**Where.** `schema.prisma:42`; `contracts/chatEntry.ts:38-45`;
`thoughtProcessing/types.ts:12-22`; `ARCHITECTURE.md:86-93`.

## <a id="per-thought-cursor"></a>Per-thought append cursor (no shared tip)

**What.** Each thought threads its own `ctx.cursorParentId`, advanced by
`appendAtCursor`. There is no global "current leaf" that appends default to.
**Why.** The implicit "parent = DB leaf" fallback "was the source of all branching
races." Explicit parents make lineage correct under concurrency; the only shared
lock just prevents `conversation_index` collisions.
**Where.** `thoughtProcessing/types.ts:44-62`; `ARCHITECTURE.md:54-106`.

## <a id="tool-param-envelope"></a>Tool-param envelope stripping

**What.** Internal keys (`tool_request`, `tool_note`, `source`, `__tool_batch`) are
stamped onto a stored invocation's params for bookkeeping, then **stripped** before
params hit a tool's strict schema or an LLM context.
**Why.** Models echo whatever arg shape they see; leaked keys made a glm-5.2 run
loop 15 silent rounds as the strict schema rejected every dispatch.
**Where.** `tools/toolParamEnvelope.ts:1-45`.

## <a id="zombie-sweeps"></a>Boot-time zombie sweeps

**What.** On startup, entries left in `running` by a crashed process are marked
terminal — thoughts → `cancelled` (with a visible retry hint), tools → `error`
(retryable). `requested` tool entries are left intact (approval survives restarts).
**Why.** Because "running" is a *persisted* state and fan-in is *derived* from it
(Layer 1), a zombie `running` row would hang its wave's fan-in and spin the UI
forever.
**Where.** thoughts `thought-processing.service.ts:66-88`; tools
`run-tool.service.ts:101-109` (they explicitly mirror each other).

## <a id="pending-messages"></a>Persisted pending messages

**What.** A message posted while a run is in flight (steer/enqueue) is stored in a
`pending_messages` table and drained on boot; not kept in RAM.
**Why.** The in-memory queue it replaced "lost them silently" on restart — dropping
text the user already typed.
**Where.** `schema.prisma:201-213`.

## <a id="response-validation"></a>Opt-in response validation interceptor

**What.** `@ValidateResponse(schema)` tags a handler; a global interceptor
`safeParse`s the response and **500s** on mismatch with the exact Zod issues.
**Why.** A malformed response is a lie to the typed client; fail loud rather than
ship it (§0.1 + Layer 1).
**Where.** `validation/validate-response.decorator.ts`,
`validation/response-validation.interceptor.ts:22-32`; installed
`app.module.ts:90`.

## <a id="error-cause-walk"></a>Exception filter walks `Error.cause`

**What.** The global HTTP exception filter collects up to 5 levels of `Error.cause`
so the *original* throw site is logged, not just the NestJS wrapper.
**Why.** NestJS wraps domain errors in `HttpException`, hiding the real stack;
transparency needs the true origin.
**Where.** `http/http-exception-logging.filter.ts:24-46`.

## <a id="syntax-selector"></a>The syntax selector

**What.** A generic engine that sniffs (possibly-partial) model text, scores each
registered dialect `Match`/`NoMatch`/`Incomplete` with a confidence, and locks onto
the best; `Incomplete` lets a streaming selector wait instead of mis-locking on a
prefix.
**Why.** Models won't commit to one output format; adding a dialect is a two-line
registration, not a new branch in the parser.
**Where.** `thoughtProcessing/syntax/types.ts:1-96`; 11 planner dialects
`lib/plannerSyntax/index.ts`.

## <a id="input-snapshot"></a>Persisted thought input (`inputJson`)

**What.** A thought's built input is serialized onto its prepare entry (server-only;
never returned on GET/SSE).
**Why.** Reprocess can rebuild the exact input with no per-provider logic — replay
is deterministic (Layer 3 — thoughts).
**Where.** `contracts/chatEntry.ts:114-119`;
`thought-processing.service.ts:150-156`; `thoughtProcessing/inputSnapshot.ts`.

## <a id="attachment-ref"></a>`attachment_ref` (metadata-only, late-expanded)

**What.** Uploads travel through requests as id+mime+filename+size references;
expanded to real image/file parts only right before the adapter call.
**Why.** Keeps `requestText`, SSE frames, and the prepare editor small and readable
while still sending ground-truth bytes to the model.
**Where.** `llmProviders/types.ts:26-39`; `llmProviders/expandAttachments.ts`;
`steps/reasonStep.ts:7`.

## <a id="registry-collision"></a>Collision-proof registries

**What.** `ToolRegistry.register` (and peers) throw on duplicate/empty names — never
last-wins.
**Why.** A rules-less tool-host proxy must not silently supersede a safety-bearing
builtin like `filesystem`.
**Where.** `tools/tool-registry.ts:14-25`.

---

### Cross-reference: which conviction each mechanism serves

| Mechanism | Serves |
| --- | --- |
| stream cursor, no replay buffer | Layer 1 derive-don't-remember |
| batch transactions | §0.1 (caught by the log gate), correctness |
| side lane, per-thought cursor | Layer 3 DAG, race-freedom |
| envelope stripping, attachment_ref | §0.2 boundary sanitize/trust |
| zombie sweeps, pending messages | Layer 1 state-is-derived + §0.1 |
| response validation, cause-walk | §0.1 surface errors, Layer 1 boundary |
| syntax selector | §0.4 vendor-neutral |
| input snapshot | §0.3 orchestrate/replay |
| registry collision | §0.1 fail-loud safety |
