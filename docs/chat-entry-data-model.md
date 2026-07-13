# Chat Entry Data Model

This doc describes the **actual DB structure** used for chat timeline data.

## Core Table

Chat timeline is stored in `chat_entries` with one row per timeline entry.

Columns:

- `id TEXT PRIMARY KEY` - entry id.
- `conversation_id TEXT NOT NULL` - conversation owner (FK to `conversations.id`).
- `conversation_index INTEGER NOT NULL` - monotonic order inside one conversation.
- `parent_id TEXT` - parent entry id in the conversation tree (logical self-link).
- `type TEXT NOT NULL` - entry type discriminator.
- `payload_json TEXT NOT NULL` - type-specific fields.
- `created_at TEXT NOT NULL` - ISO timestamp.

Conversation linkage:

- `conversations.active_leaf_entry_id` points to the currently active leaf in the branch tree.

## Entry Types In DB

`type` is one of:

- `user-message`
- `assistant-message`
- `thought`
- `tool-invocation`
- `checkpoint-summary`
- `context-injection`
- `retrieval`

Shared top-level (outside payload) for all entries:

- `id`, `conversation_id`, `conversation_index`, `parent_id`, `is_side`, `type`, `created_at`

History: thoughts used to be a three-row triplet (`thought-prepare` /
`thought_stream` / `thought-action`, glued by a `thoughtId` payload key) and
before that per-thought stream types (`planner_llm_stream`, …). The
`thought_stream_unify` migration collapsed the stream types; the
`thought_merge` migration (2026-07-13) collapsed the triplet into the single
`thought` type below. See `docs/thought-merge-plan.md`.

## `payload_json` Shapes

### `user-message`

- `text: string`
- `agentId: string`
- optional: `llm`, `modelPresetId`, `attachments[]`, `overrides`

### `assistant-message`

- `text: string`

### `thought`

One row per thought — the prepared request, the streamed LLM cycle, and the
decision merge onto the same payload as the stages run:

- `thoughtType: "planner" | "title" | "tool_params" | "summarize" | "summarize_attachment" | "guardrail" | "categorize" | "rag_planning"` (required)
- `stage: "prepare" | "reason" | "decide"` (required — deepest stage started)
- `status: "running" | "completed" | "failed" | "cancelled"` (required — one
  status for the whole thought; a completed prepare is `stage: 'reason'` with
  `status: 'running'`, and a failure keeps `stage` pointing at where it struck)
- prepare outputs: `llmRequest` (the display/edit surface — exactly what hits
  the wire), `title`, `llm`, `inputJson` (server-only reprocess snapshot,
  stripped from GET/SSE)
- reason outputs: `llmResponse`, `assembledResponse`, `thinkingText`,
  `thoughtMs`, token/cost fields (`promptTokens`, `cachedPromptTokens`,
  `completionTokens`, `provider_cost`, `provider_cost_breakdown`)
- decision outputs: `decision`, `parseResult`, `summary`, `action`, `toolName`
- fork metadata (reprocess siblings only): `forkOf` (source thought id),
  `forkPoint: "context" | "reason"` — `context` means the request was edited
  or re-run on another model; `reason` means the request was kept verbatim and
  the response was replaced (only the decision ran). The request is **copied**
  at fork time, never referenced.
- `summarize_attachment` extras: `attachmentId` + `userMessageId` (mapper-required),
  `filename`, `mimeType`, `sizeBytes`, `summaryText`
- optional: `error`

### `tool-invocation`

- `toolId: string`
- `state: "resolving" | "requested" | "running" | "done" | "error" | "denied"`
- `parameters: object`
- `result: unknown`

## Relationship Model

- **Tree linkage** via `parent_id` (branch structure and active lineage) —
  the only grouping layer; a thought is one row, so there is no payload-level
  thought grouping anymore.
- `parent_id` and `default_view_leaf_entry_id` are logical references (not
  enforced FK constraints).

## Read Behavior

- Default message fetch returns active lineage only (following `active_leaf_entry_id` through `parent_id` chain).
- `?all=1` returns all entries in `conversation_index` order.

## Write Path: Transactions & Locking

Stack: SQLite (WAL) via Prisma 7 + the `better-sqlite3` driver adapter (engine-free client). Facts below marked *verified* come from probes run against this exact stack on 2026-07-11.

How writes are serialized:

- **Every write is a batch transaction** (`$transaction([...])`): one synchronous BEGIN/COMMIT, statements precomputed — a batch cannot span an `await`. The SSE stream-cursor bump rides the same batch as the write it stamps.
- **Read-decide-write sequences** (leaf lookup before append, `splitOffSubtree`) are serialized per conversation by the in-process `withAppendLock` mutex; the batch then commits the precomputed plan atomically.

Verified engine/driver semantics:

- The adapter issues plain deferred `BEGIN`; it does not expose `BEGIN IMMEDIATE`.
- Under deferred `BEGIN`, concurrent read-then-write does **not** interleave silently: if another connection commits a write between your read and your write, your write fails immediately with `SQLITE_BUSY_SNAPSHOT` (`busy_timeout` does not apply to a stale snapshot; the whole transaction must be retried). *Verified.*
- `BEGIN IMMEDIATE` serializes read-decide-write across connections correctly: the second transaction blocks until the first commits, then re-reads and chains cleanly. The wait is a synchronous thread block inside better-sqlite3, so it can mediate cross-process contention; in-process, `withAppendLock` provides the equivalent wait on the event loop instead. *Verified.*
- SQLite locking is database-wide — one writer at a time, no row locks.
- Raw query results surface SQLite integers as JS `BigInt`.

Interactive transactions (`$transaction(async (tx) => …)`) are governed by `TX_MAX_OPEN_MS` (2s) in `PrismaService`:

- Prisma's `transactionOptions.timeout` rolls the transaction back and releases the writer lock **at** the deadline — a second connection can write while the overdue callback is still mid-`await`. *Verified.*
- The `$transaction` promise itself only rejects once the callback settles (never, if it's stuck on a dead `await`), so `installTxOpenGuard` additionally rejects the caller at deadline+250ms with an error naming the opening call site. Covered by `tests/integration/integration/tx-open-guard.integration.spec.ts`.

History note: the June 2026 interactive-transaction freeze happened on the Prisma 6 Rust engine, which no longer exists under Prisma 7. Earlier code comments blamed prisma/prisma#11750 — wrong attribution: that issue closed in 2022 and its fix concerned `SELECT FOR UPDATE`, which SQLite doesn't support.

## Probe Time Expected Sequence

For the `what is the time?` probe flow, expected order is:

1. auto title thought (side lane, anchored at the user message)
2. planner thought
3. realtime assistant feedback starts streaming
4. tool call (pre-created on the spine at dispatch)
5. tool parameter resolution thought (side lane, anchored at the tool entry)
6. planner continuation thought (anchored at the batch tail)
7. final assistant feedback streams and completes
