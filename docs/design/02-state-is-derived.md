# Layer 1 — The DB is the single source of truth; state is derived

**The choice.** Runtime workflow state — which branch is live, whether a tool
batch is finished, whether the planner may continue, what messages are queued — is
**computed from the persisted chat-entry DAG on demand**, not held in an in-memory
scoreboard. In-memory structures exist only as *same-tick concurrency gates*, never
as the authoritative copy of anything that must survive a request or a restart.

This is a Layer-1 conviction because it shapes every subsystem underneath it: the
SSE watermark, the tool fan-in, the branch resolution, the message queue all obey
it.

---

## Why

An agentic run is long-lived and interruptible: the backend can restart mid-turn,
two tool approvals can land in different HTTP requests, a user can steer or retry
at any moment. An in-memory scoreboard of "tools still pending in this batch"
*forgets half its state on restart* and races under concurrency — and when it's
wrong, the planner either stalls forever or double-continues. The fix that keeps
recurring in this codebase is the same: **stop remembering, start deriving.** The
DAG already records what happened; ask it.

This is §0.1 and §0.2 applied to *time*: don't trust a cached belief about the
world when the durable record is right there; if they disagree, the record wins.

A dedicated memory note records this as a standing rule: *derive workflow state
(fan-in, queues, approvals) from the DB; in-memory only for same-tick concurrency
gates.*

---

## How it shows up in code

### Branch resolution walks the tree; it doesn't cache a tip

`conversations.default_view_leaf_entry_id` stores only a **user anchor** (the entry
the user last selected). The live leaf is *resolved* by walking children to the tip
at read time, so new descendants never need to update the anchor:

> "When the API has to answer 'what leaf should I render?' the repo resolves the
> anchor to its current branch tip by walking children … until there are none.
> This means we don't have to update the anchor as new descendants arrive — the
> walk-down naturally yields the live tip."
> — `backend/src/thoughtProcessing/ARCHITECTURE.md:24-32`

Running scopes are *forbidden* from writing that anchor; only user actions do
(`ARCHITECTURE.md:192-197`, invariant #2).

### Tool fan-in is a query, not a counter

Whether the planner resumes after a tool batch is decided from chat history —
"does the batch have zero tools still `requested`/`running`?" — not from an
in-memory tally:

> "Whether planning resumes is decided from the CHAT HISTORY … The DB is the
> single source of truth, so an approval that arrives after a backend restart
> still fans in correctly — the previous in-memory scoreboard forgot half-resolved
> [batches]."
> — `backend/src/tools/run-tool.service.ts:728-735`

The only in-memory piece is a per-conversation lock that *serializes* the check so
two siblings don't evaluate it in the same tick — explicitly "purely a concurrency
gate — the pending state itself is derived from the chat entries, never stored
here" (`run-tool.service.ts:80-85`).

### Batch shape is fixed in the DB at dispatch, so fan-in has a stable target

The planner **pre-creates every tool-invocation entry of a batch on the spine, in
request order**, before any runs. Params resolution, guardrails, approval and
execution only *update* those rows. So "the batch tail is a static fact, however
members settle," and "one continuation per completion is enforced from the DB
('does the tail already have a spine child?'), restart-safe"
(`ARCHITECTURE.md:78-84`).

### Queued messages are persisted, not held in RAM

A message accepted while a run is in flight goes into a `pending_messages` table,
precisely because the in-memory queue it replaced "lost them silently" on restart:

```prisma
// backend/prisma/schema.prisma:201-213
// A user message accepted while a run was in flight … Persisted so a backend
// restart cannot drop text the user already typed — boot drains leftovers
// instead (the in-memory queue this replaces lost them silently).
model PendingMessage { … }
```

### Zombie sweeps reconcile memory-vs-DB on boot

Because "running" is a persisted state, a process that dies mid-run leaves rows
that can never settle. Two boot sweeps mark them terminal so the derived fan-in and
the UI don't hang forever:

- thoughts: `thought-processing.service.ts:66-88` (`listRunningThoughtEntries` →
  mark `cancelled` with a visible reason),
- tools: `run-tool.service.ts:101-109` (mark `error`, retryable).

Both explicitly mirror each other ("Mirrors RunToolService's zombie tool sweep").

---

## The frontend obeys the same law, mirrored

The client keeps the full entry set plus one piece of local state (`activeLeafId`)
and **derives everything else**:

> "`useChatSession` keeps an `ObservableItemCollection` of all entries … plus an
> `activeLeafId`. … From those it derives `activePathEntries` (walk from
> `activeLeafId` via `parentId` to the root) and `allEntries`."
> — `ARCHITECTURE.md:160-174`

Updates are SSE-driven mutations of that collection, and — invariant #5 — the
frontend must *derive* view state rather than ask the server to re-push it: "Don't
add reload events; emit the right `CHAT_ENTRY_UPSERT` / `DELTA` instead"
(`ARCHITECTURE.md:201-203`). This is why the streaming layer can be so thin (see
[Layer 3 — SSE](05-sse-streaming.md)).

---

## What it forbids

- **No authoritative in-memory cross-request state.** If a fact must survive a
  restart or be seen by a later request, it lives in the DB. In-memory is allowed
  only as a same-tick lock/gate whose loss is harmless.
- **No cached branch tip.** Resolve by walking; don't maintain a "current leaf"
  variable that mutations must remember to update.
- **No counting what you can query.** Fan-in, "is anything pending", "did a
  continuation already happen" are DB questions.

## The single-process caveat (honestly stated)

The append lock and fan-in serialization are in-process today; the *state* they
guard is DB-derived, so correctness survives restarts. The code names the seam:
"If we ever shard the backend, the same-tick gates move to DB-level advisory
locks" (`ARCHITECTURE.md:103-106`). The point: the durable truth is already in the
right place; only the concurrency gate is provisional.
