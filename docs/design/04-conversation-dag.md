# Layer 3 — The conversation DAG

> **2026-07-13:** the thought triplet mentioned below (`thought-prepare` /
> `thought_stream` / `thought-action` glued by `thoughtId`) was merged into a
> single `thought` entry per thought — see `docs/thought-merge-plan.md`. The
> DAG mechanics in this chapter are unchanged; only the thought row count and
> the grouping layer differ.

**The choice.** A conversation is **one append-only table** (`chat_entries`) of
typed entries linked by `parent_id` into a tree. Nothing is ever destructively
edited; editing the past means growing a **new sibling branch**. There is no
shared mutable "chain tip" — every producer states its causal parent explicitly.
A **side lane** flag keeps bookkeeping thoughts off the branch structure.

This is the substrate the thought pipeline and tools write into, so it sits
directly under them. It's the concrete realization of Layer 1's "state is derived"
(the tree *is* the state) and Layer 0's "orchestrate, don't abstract" (branching
is first-class, not a hidden undo buffer).

Primary sources: `backend/src/thoughtProcessing/ARCHITECTURE.md`,
`docs/chat-entry-data-model.md`, `backend/prisma/schema.prisma:37-51`.

---

## One table, discriminated rows

```prisma
// backend/prisma/schema.prisma:37-51
model ChatEntry {
  id                String
  conversationId    String
  conversationIndex Int      // strictly increasing per conversation, assigned at insert
  parentId          String?  // previous entry in this lineage; NULL at root
  isSide            Boolean  // side-lane flag (see below)
  type              String   // discriminator
  payloadJson       String   // type-specific fields
  createdAt         DateTime
  @@index([conversationId, conversationIndex])
  @@index([parentId])
}
```

`type` is one of 8 variants — `user-message`, `assistant-message`,
`thought-prepare`, `thought_stream`, `thought-action`, `tool-invocation`,
`checkpoint-summary`, `context-injection` — each with its own `payload_json` shape,
all defined in the shared `ChatEntrySchema` union (`contracts/chatEntry.ts:272-282`,
Layer 1). The row is the storage; the Zod union is the trusted view; the mapper is
the one-way boundary between them (`chat-entry.mapper.ts`, §0.2).

## Why a parent-pointer DAG, not a flat list

Stated directly (`ARCHITECTURE.md:34-41`):

- **Branching is a first-class feature** — re-editing context or reasoning produces
  a true sibling branch instead of mutating history.
- **Switching the viewed branch is a single pointer flip**
  (`UPDATE conversations SET default_view_leaf_entry_id = ?`), no row mutation.
- **Old branches stay queryable / re-selectable.**

The "active path" shown in chat is just the parent-chain walked from the resolved
leaf back to the root (`ARCHITECTURE.md:31-33`).

## Two linkage layers (don't conflate them)

`docs/chat-entry-data-model.md:88-99` is explicit that there are two independent
relationships:

1. **Tree linkage** via `parent_id` — branch structure and active lineage.
2. **Thought grouping** via `payload_json.thoughtId` — ties a thought's
   `prepare` + `stream` + `action` entries together.

Both `parent_id` and `thoughtId` are **logical** references, not enforced FKs —
the app owns their integrity, and the mapper throws if a payload is malformed
rather than the DB rejecting a write. (This is §0.2: trust internal shape, validate
at the mapper boundary.)

## The anti-pattern this design killed: the shared cursor

The single most emphasized decision here is the **removal of an implicit "parent =
current DB leaf" fallback**, which "was the source of all branching races"
(`ARCHITECTURE.md:54-57`). Two rules replace it:

- **`appendEntry` requires an explicit `parentId` from every caller** — no implicit
  default.
- **User-initiated appends** take the parent from the request (the UI knows where
  the user attached the message); **forward-flow steps** parent at an explicit
  causal anchor.

The mechanism is a **per-thought cursor**, not a shared one. A thought's steps
thread `ctx.cursorParentId`, which advances with each append via `appendAtCursor`,
so a thought's entries form one contiguous run under the anchor its starter chose:

```ts
// backend/src/thoughtProcessing/types.ts:55-62
export async function appendAtCursor<T extends { id: string }>(ctx, fn) {
  const created = await fn(ctx.cursorParentId, ctx.lane === 'side');
  ctx.cursorParentId = created.id;   // advance THIS thought's cursor
  return created;
}
```

The only shared lock is a per-conversation append lock whose *sole* job is
preventing `MAX(conversation_index)+1` collisions — "lineage correctness comes from
explicit parents," not from the lock (`ARCHITECTURE.md:99-106`).

## Causal anchors: who parents where

`startThought(anchorParentId, lane, …)` — the caller states, from its own
knowledge, where a thought belongs (`ARCHITECTURE.md:59-84`):

- the planner anchors at the user message (or the context-injection entry after
  it),
- a batch continuation anchors at the batch tail,
- reprocess anchors at the source entry's parent — a deliberate sibling branch.

Because the planner **pre-creates the whole tool batch on the spine at dispatch**
(state `resolving`), the chain shape through a batch is fixed up front and the tail
is a static anchor no matter how members settle (`ARCHITECTURE.md:78-84`). See
[Layer 3 — tools](07-tools-and-permissions.md).

## The side lane

`is_side = 1` marks **bookkeeping thoughts** — title generation, categorization,
attachment summaries, tool-param resolution, guardrail checks — that hang off a
spine entry *for display* but are excluded from branch semantics everywhere:

> "They are excluded from branch semantics everywhere — leaf walks, fork counting,
> the frontend chosen path — so any number can run concurrently against the same
> anchor without ever forking the conversation."
> — `ARCHITECTURE.md:86-93`, and the type doc `thoughtProcessing/types.ts:12-22`.

This is what lets, e.g., a title thought and the planner run **concurrently off the
same user message** without one becoming a "branch" of the other
(`ARCHITECTURE.md:120-123`). The planner input folds *side* `summarize_attachment`
streams back in; other side thoughts contribute nothing to prompts.

`ChatEntryBaseSchema.isSide` carries the flag on the wire with a comment explaining
the exclusion (`contracts/chatEntry.ts:38-45`).

## Reads

- Default fetch returns the **active lineage only** — resolve the anchor to its
  live tip, then walk `parent_id` to root (`docs/chat-entry-data-model.md:100-104`,
  Layer 1 "derive, don't cache").
- `?all=1` returns every entry in `conversation_index` order — used by the activity
  panel to draw the whole branch tree.

## Invariants worth preserving (verbatim from the source)

`ARCHITECTURE.md:187-204` lists five; the load-bearing ones:

1. Forward-flow appends go through `chain.append(parentId => …)`; only branch roots
   pass a hand-picked `parentId`.
2. Running scopes never write `default_view_leaf_entry_id`; only user actions do.
3. HTTP handlers don't `await` LLM/tool work.
4. Each pipeline step creates its own entry — **no upfront placeholder rows** (so
   the DB is always a faithful record of what actually happened, and a cancelled
   step leaves no orphan: `ARCHITECTURE.md:43-52`).
5. Frontend derives from `(allEntries, activeLeafId)`; don't add reload events.
