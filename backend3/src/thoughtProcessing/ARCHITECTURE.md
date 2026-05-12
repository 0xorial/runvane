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

`conversations.active_leaf_entry_id` points at the tip of the currently selected
lineage. The "active path" shown in chat is the parent-chain walked from that leaf
back to the root.

Why a parent-pointer DAG instead of a flat list:

- Branching is a first-class feature (re-edit context / re-edit reasoning produces
  a true sibling branch rather than mutating history).
- Switching the active branch is a single pointer flip
  (`UPDATE conversations SET active_leaf_entry_id = ?`), no row mutations.
- Old branches stay queryable / re-selectable.

## 2. Lazy entry creation per step

Each pipeline step (`prepareStep`, `reasonStep`, `decisionStep`) creates its own
entries as it runs. We do **not** pre-allocate placeholder rows for a thought.

Consequences:

- Activity panel fills in incrementally instead of flashing pre-empty rows.
- A step that never runs (cancelled, error before start) leaves no orphan row.
- The DB is always a faithful record of what actually happened.

## 3. Leaf-based parents — explicit parents only at branch roots

Inside `ChatEntriesRepo.appendEntry`:

- If the caller does **not** pass `parentId`, the parent is the current
  `active_leaf_entry_id` (read inside the same transaction).
- If the caller passes an explicit `parentId`, it is honored verbatim.

Rule of thumb across the codebase:

- **Normal forward flow** (user message, planner steps, tool invocations,
  assistant message, autoTitle steps, …): no explicit `parentId`. The leaf is
  the source of truth.
- **Reprocess / explicit branching** (`startReprocessContext`,
  `startReprocessReason`): the entry-point passes an explicit `parentId` to root
  the new branch; everything that follows in that branch goes back to leaf-based
  appends.

This rule is what keeps the active chain linear when multiple thoughts run in
parallel. Any code that pins a forward-flow entry to a specific ancestor (e.g.
"assistant-message child of my own thought-action") will create sibling branches
the moment another thought races ahead — exactly the bug we hit with
`appendAssistantMessage` and removed.

## 4. Per-conversation append lock + transactional insert

`ChatEntriesRepo` holds an in-process `Map<conversationId, Promise<unknown>>`
serializing all `appendEntry` calls for a single conversation. Inside the lock
each append is one transaction that:

1. Reads `MAX(conversation_index) + 1`.
2. Reads `active_leaf_entry_id` (when no explicit parent).
3. INSERTs the row.
4. Updates `active_leaf_entry_id` and `last_message_at` on `conversations`.

Why:

- Without the lock, two concurrent thoughts both read leaf `L`, both insert with
  `parent_id = L`, both bump `active_leaf_entry_id` — and you get a sibling
  branch. The lock collapses that race into a strict order.
- The transaction also fixes the second race: `conversation_index` collisions
  from concurrent appends.

Single-process assumption: this is an in-process mutex. If we ever shard the
backend, this needs to move to a DB-level advisory lock or the conversation
needs a stable owner.

## 5. Concurrency model: structured per-conversation scopes

`ConversationProcessorService` owns one `LifecycleScope` per active conversation
(`beginScope(conversationId)`):

- HTTP handlers (`processMessage`, `startReprocessContext`,
  `startReprocessReason`) do **only** the synchronous prep — append the entry
  point row, set up `ctx`, publish initial SSE — then return.
- The rest of the work (LLM call, decision, downstream tool thoughts) runs via
  `scope.spawn(async () => …)`. Spawned tasks are tracked by the scope so
  cancellation / completion is visible to the parent.
- `autoTitle` and `planner` for the very first user message run as two
  independent `scope.spawn` tasks — concurrent on purpose, serialized at write
  time by the append lock (see §4).

The HTTP layer never `await`s background work. It's an explicit invariant —
clients get an immediate response and observe progress over SSE.

## 6. Re-processing is the only place `parentId` is special

Two re-process entry points:

- `startReprocessContext` — user edited the prompt of a past thought. Creates a
  fresh `thought-prepare` rooted at the original prepare's parent (sibling of
  the original).
- `startReprocessReason` — user edited the LLM response of a past thought.
  Creates a fresh `planner_llm_stream` + `thought-action` rooted on the
  original's `prepare` entry (sibling of the original stream).

Both then run the rest of the planner pipeline in `scope.spawn` using leaf-based
appends, so the new branch grows linearly. No other code path supplies an
explicit `parentId`.

## 7. SSE contract

Two events do all the heavy lifting:

- `CHAT_ENTRY_UPSERT { entry }` — full snapshot of an entry; sent on create and
  on any non-streaming update (status changes, decision persistence, etc.).
- `CHAT_ENTRY_DELTA { chatEntryId, field, delta }` — append-only string delta on
  a specific text field of an entry (`llmResponse`, assistant `text`, …).

Other, smaller events (`USER_MESSAGE`, `TOOL_INVOCATION_START/END`,
`CONVERSATION_UPDATED`) are notifications that don't change chat-entry state.

There is no per-step lifecycle event (`thought_*_started/finished`) — those were
removed; status transitions happen via `CHAT_ENTRY_UPSERT` of the underlying
entry.

## 8. Frontend mirror

`useChatSession` keeps an `ObservableItemCollection` of **all** entries for the
current conversation plus an `activeLeafId`. From those it derives:

- `activePathEntries` — walk from `activeLeafId` via `parentId` to the root,
  reversed.
- `allEntries` — the full set, used by the activity panel for the branch tree.

Updates are SSE-driven:

- `CHAT_ENTRY_UPSERT` → upsert the entry; if it's new, advance `activeLeafId`.
- `CHAT_ENTRY_DELTA` → mutate the named field on the existing entry.

There is no chat-wide "refresh" event. Branch switching calls `setActiveLeaf`
which only flips the local `activeLeafId` (and PATCHes the conversation), the
existing in-memory entries take care of the rest.

## 9. Internal data is trusted

Everything sourced from the repo (rows, payloads) is trusted shape — we don't
re-validate `parent_id`, `conversation_index`, payload schemas mid-stack. If a
row is malformed, the mapper / consumer throws. External boundaries
(HTTP DTOs, LLM output parsing) are the only places we sanitize.

## 10. Invariants worth preserving

If you add new code, keep these true:

1. Forward-flow appends never pass `parentId`. Only reprocess entry points do.
2. All appends go through `ChatEntriesRepo.appendEntry` (so they're locked +
   transactional).
3. HTTP handlers don't `await` LLM / tool work — spawn into the
   per-conversation `LifecycleScope`.
4. Each pipeline step owns the creation of its own entry (no upfront
   placeholders).
5. Frontend derives state from `(allEntries, activeLeafId)`. Don't add reload
   events; emit the right `CHAT_ENTRY_UPSERT` / `DELTA` instead.
