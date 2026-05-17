# Thought / Step Storage & Processing — Architecture

Scope: how chat entries (messages, thought steps, tool invocations, etc.) are
persisted, ordered, and streamed to the UI. Everything else (LLM providers,
prompt assembly, tool registry) is intentionally out of scope.

## 1. One table, parent-pointer DAG

All conversation events live in a single `chat_entries` table with a discriminated
`type` and a JSON `payload_json`.

Each row carries:

- `parent_id` — pointer to the previous entry in its lineage (`NULL` for the root).
- `conversation_index` — strictly increasing per conversation, assigned at insert.
- `created_at` — wall-clock timestamp.

`conversations.default_view_leaf_entry_id` is a **user anchor**: it stores
the entry the user last selected. It is only ever written by user-driven
actions (a posted user message, a reprocess that creates a new branch, an
explicit branch switch via `POST /default-view-leaf`). Running thoughts and
followups never touch it.

When the API has to answer "what leaf should I render?" (`GET
/api/conversations/:id`, internal `listMessages` / `listChatEntries`) the
repo resolves the anchor to its current branch tip by walking children
(`ORDER BY conversation_index DESC LIMIT 1`) until there are none. This
means we don't have to update the anchor as new descendants arrive — the
walk-down naturally yields the live tip.

The "active path" shown in chat is the parent-chain walked from the resolved
leaf back to the root.

Why a parent-pointer DAG instead of a flat list:

- Branching is a first-class feature (re-edit context / re-edit reasoning produces
  a true sibling branch rather than mutating history).
- Switching the default view is a single pointer flip
  (`UPDATE conversations SET default_view_leaf_entry_id = ?`), no row mutations.
- Old branches stay queryable / re-selectable.

## 2. Lazy entry creation per step

Each pipeline step (`prepareStep`, `reasonStep`, `decisionStep`) creates its own
entries as it runs. We do **not** pre-allocate placeholder rows for a thought.

Consequences:

- Activity panel fills in incrementally instead of flashing pre-empty rows.
- A step that never runs (cancelled, error before start) leaves no orphan row.
- The DB is always a faithful record of what actually happened.

## 3. `parentId` is always explicit

`ChatEntriesRepo.appendEntry` requires `parentId: string | null` from every
caller. There is no implicit "parent = current leaf in the DB" fallback — that
was the source of all branching races. Two rules:

- **User-initiated appends** (POST `/messages`, reprocess endpoints) take the
  parent from the request payload — the UI knows where the user wanted the
  message attached.
- **Forward-flow steps inside a running scope** parent at the run's `ChatChain`
  tip (see §4). The chain is shared across all thoughts spawned in the run, so
  concurrent thoughts interleave linearly instead of branching.

## 4. `ChatChain` — concurrent thoughts interleave linearly

A `ChatChain` is a per-run domain object owned by `ConversationProcessorService`
(created in `beginRun` alongside the `LifecycleScope`). It holds:

- `tip: string | null` — current parent for the next forward-flow append.
- a serializing mutex.

Forward-flow appends call `chain.append(parentId => repo.appendXxx({…, parentId}))`:

1. Mutex acquires under FIFO order.
2. The current `tip` is passed to the append callback as `parentId`.
3. On success, `tip` advances to the new entry's id.

`ConversationProcessorService` seeds the tip after the user-message append
(`chain.setTip(userEntry.id)`) and then starts `autoTitle` + `planner`. The
order of their **first** entries on the chain is deterministic, not racy:
`startThought` calls `chain.append` for the prepare entry
**synchronously** (before `scope.spawn`), so the mutex slot is captured at
caller-call order rather than at microtask resolution time. To keep that call
synchronous, the LLM provider/model is fetched once per run as `LlmRef` and
passed in. Subsequent forward-flow appends (stream, action, assistant message,
tool invocation) chain through the same `tip`, so concurrent thoughts
interleave linearly:
`user → titlePrepare → plannerPrepare → titleStream → plannerStream → …`.

Reprocess entry points seed the chain tip to the chosen branch root before
spawning the reprocess pipeline. Tool-execution and tool-params thoughts run
under the same chain and chain through the same tip.

`LifecycleScope` is intentionally separate — it only handles execution
lifecycle (cancellation signal + spawned-task completion bookkeeping). It does
not know about chat-entry lineage. The chain travels alongside the scope as a
distinct parameter through the pipeline.

`ChatEntriesRepo` also keeps a per-conversation append lock, but its only job
is preventing `MAX(conversation_index) + 1` collisions — lineage correctness
is owned by `ChatChain`.

Single-process assumption: both mutexes are in-process. If we ever shard the
backend, both move to DB-level advisory locks or per-conversation owner.

## 5. Concurrency model: structured per-conversation scopes

`ConversationProcessorService` owns one `LifecycleScope` per active conversation
(`beginScope(conversationId)`):

- HTTP handlers (`processMessage`, `startReprocessContext`,
  `startReprocessReason`, `reprocessUserMessage`) do **only** the synchronous
  prep — append the entry-point row, set up `ctx`, publish initial SSE — then
  return.
- The rest of the work (LLM call, decision, downstream tool thoughts) runs via
  `scope.spawn(async () => …)`. Spawned tasks are tracked by the scope so
  cancellation / completion is visible to the parent.
- `autoTitle` and `planner` for the very first user message run as two
  independent `scope.spawn` tasks — concurrent on purpose. They share the
  run's `ChatChain`, so their appends interleave linearly off the user
  message instead of forking into siblings.

The HTTP layer never `await`s background work. Clients get an immediate
response and observe progress over SSE.

## 6. Branching points

Every place that creates a sibling branch passes an explicit `parentId`:

- `processMessage` — `parentId` from the client (the user's currently viewed
  leaf at send time).
- `reprocessUserMessage` — `parentId` = source user message's parent (sibling
  of the source).
- `startReprocessContext` — fresh `thought-prepare` rooted at the original
  prepare's parent.
- `startReprocessReason` — fresh `planner_llm_stream` + `thought-action` rooted
  at the original prepare entry.

Everything else inside a running thought parents through `chain.append`, which
serializes on the run's chain tip seeded by the entry point.

## 7. SSE contract

Two events do all the heavy lifting:

- `CHAT_ENTRY_UPSERT { entry }` — full snapshot of an entry; sent on create and
  on any non-streaming update (status changes, decision persistence, etc.).
- `CHAT_ENTRY_DELTA { chatEntryId, field, delta }` — append-only string delta on
  a specific text field of an entry (`llmResponse`, assistant `text`, …).

Other, smaller events (`USER_MESSAGE`, `TOOL_INVOCATION_START/END`,
`CONVERSATION_UPDATED`) are notifications that don't change chat-entry state.

There is no per-step lifecycle event — status transitions happen via
`CHAT_ENTRY_UPSERT` of the underlying entry.

## 8. Frontend mirror

`useChatSession` keeps an `ObservableItemCollection` of **all** entries for the
current conversation plus an `activeLeafId` (the user's currently viewed
leaf). On initial load `activeLeafId` is seeded from the server's
`defaultViewLeafEntryId` hint; from then on it's purely client state. From
those it derives:

- `activePathEntries` — walk from `activeLeafId` via `parentId` to the root,
  reversed.
- `allEntries` — the full set, used by the activity panel for the branch tree.

Updates are SSE-driven:

- `CHAT_ENTRY_UPSERT` → upsert the entry; if it's new, advance `activeLeafId`.
- `CHAT_ENTRY_DELTA` → mutate the named field on the existing entry.

When the user picks a branch in the panel, the UI flips `activeLeafId` locally
and PATCHes the server's hint via `setConversationDefaultViewLeaf` so reload
shows the same branch.

## 9. Internal data is trusted

Everything sourced from the repo (rows, payloads) is trusted shape — we don't
re-validate `parent_id`, `conversation_index`, payload schemas mid-stack. If a
row is malformed, the mapper / consumer throws. External boundaries
(HTTP DTOs, LLM output parsing) are the only places we sanitize.

## 10. Invariants worth preserving

If you add new code, keep these true:

1. Forward-flow appends go through `chain.append(parentId => …)`. Don't pass
   a hand-picked `parentId` for forward flow — only branch roots (reprocess,
   user message) do that, and they call `chain.setTip` once before spawning
   the pipeline.
2. Running scopes never write `default_view_leaf_entry_id`. Only user-driven
   actions (post message, reprocess root, explicit branch-switch endpoint)
   write the anchor; reads resolve it to the current leaf via walk-down.
3. HTTP handlers don't `await` LLM / tool work — spawn into the
   per-conversation `LifecycleScope`.
4. Each pipeline step owns the creation of its own entry (no upfront
   placeholders).
5. Frontend derives state from `(allEntries, activeLeafId)`. Don't add reload
   events; emit the right `CHAT_ENTRY_UPSERT` / `DELTA` instead.
