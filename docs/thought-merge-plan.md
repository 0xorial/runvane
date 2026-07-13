# Thought merge — one entry per thought

Status: IMPLEMENTED 2026-07-13 (migration `20260713090000_thought_merge`).

Collapse the `thought-prepare` / `thought_stream` / `thought-action` triplet
into a single `thought` chat entry. Branching moves from step granularity to
thought granularity: a reprocess creates a *sibling thought* carrying fork
metadata that records which part changed, instead of forking at an
intra-thought row boundary.

## Why

Measured on a real integration DB: 481 of 661 rows (73%) were triplet rows for
160 logical thoughts. The triplet's costs, from the 3-entries review:

- **Payload-glued grouping**: `thoughtId` joins the three rows by convention,
  not FK; every consumer (frontend triplet stitching, provider resolution)
  re-implements the join and must tolerate partial groups mid-write.
- **Typeless rows**: only the stream row carries `thoughtType`; prepare/action
  rows are unidentifiable without the join.
- **3× row/SSE/write amplification** for every thought.
- The same string is stored twice (`prepare.requestText` == `stream.llmRequest`).

The frontend already renders the triplet as one visual row
(`ThoughtTripletRow` anchored on prepare; stream/action render nothing
standalone) — the merged model is what the UI already pretends is true.

## Decisions

**T1 — One entry type, self-describing.** `type: 'thought'` with `thoughtType`
present from the initial insert (the provider is known at start time — better
than today, where the prepare row is typeless). Per-thoughtType extras
(planner `parseResult`/`decision`, summarize_attachment `attachmentId`…)
stay optional fields on the same entry.

**T2 — Single status + stage, not three statuses.** The pipeline is
sequential, so one `status` (`running|completed|failed|cancelled`) plus
`stage` (`prepare|reason|decide` = deepest stage started) captures every state
the three per-row statuses could express. Step completion becomes a stage
advance (`prepare` done → `{stage:'reason', llmRequest}`); only the final
decision (or a failure/cancel) flips `status`. A crashed thought is a row
whose `stage` names where it died — the faithful-record property survives at
field level.

**T3 — Forks are sibling thoughts with fork metadata.** Both reprocess flows
append a NEW thought entry at the source thought's parent (same lane):

- *reprocess-context* (edit request / try model): new sibling with the edited
  (or copied) `llmRequest`, `forkOf: <source id>`, `forkPoint: 'context'`;
  reason + decide run fresh.
- *reprocess-reason* (edit the LLM response): new sibling with `llmRequest`
  copied verbatim, `llmResponse` = the edited text, `stage: 'decide'`,
  `forkOf`, `forkPoint: 'reason'`; only the decision runs.

The request is **copied**, not referenced — a `requestRef` would reintroduce
exactly the cross-row dependency this removes. Copy-at-fork is also what makes
the "same prepared input" guarantee hold (immutable copy). Both endpoints now
take the thought entry id (`POST …/thoughts/:entryId/reprocess-{context,reason}`).

**T4 — Branch UI labels fork kinds.** A parent can now hold both message-edit
siblings and thought-fork siblings; `forkPoint` (+ the thought's `llm`) is the
display discriminant ("retry · deepseek…" vs an edited request). Today these
forks render at the prepare/stream chips; after the merge the existing
BranchSelector on the (single) thought row covers all of them.

**T5 — SSE contract unchanged.** `CHAT_ENTRY_DELTA` keeps targeting fields
`llmResponse` / `thinkingText`, now on the thought entry id. Status/stage
flips ride `CHAT_ENTRY_UPSERT` as before. Accepted cost: non-delta upserts of
a thought now carry request + stream text + decision together (fatter rows,
local SQLite scale — noise).

**T6 — `thoughtId` leaves the contract.** The entry id IS the thought
identity. `ThoughtContext` keeps a single `thoughtEntryId`
(prepare/stream/action ids collapse). Stale `thoughtId` keys in migrated
payloads are harmless (mapper strips unknowns).

**T7 — Servable at every committed state (D8).** The initial insert carries
everything the schema requires (`thoughtType`, `stage`, `status`);
`streamEntryExtraPayload` extras land in the same insert when input is passed
up front, else with the prepare merge — either way before any typed-read
window opens.

**T8 — Migration collapses triplets in place, splice-out re-parenting.**
Hand-written SQL (never prisma auto-diff), one transaction:

1. Group triplet rows by `(conversation_id, payload.thoughtId)`.
2. Survivor = the prepare row (keeps id / conversation_index / created_at —
   anchors pointing at it stay valid). Merge stream+action payloads onto it;
   compute `stage`/`status` (action status wins, else stream, else prepare),
   single `error`, `llmRequest = coalesce(stream.llmRequest, prepare.requestText)`,
   `thoughtType` from the stream (prepare-only zombies: derived from the
   prepare `title` → provider map, fallback `planner`).
3. Reason-fork groups (N>1 streams under one prepare): stream #1 merges into
   the prepare; each later stream *transforms in place* into its own thought
   row (keeps its id), re-parented to the prepare's parent, stamped
   `forkOf: <prepare id>, forkPoint: 'reason'`, with `title`/`llm`/`inputJson`
   copied from the prepare. Its action merges into it.
4. Deleted rows (streams #1, all actions): every surviving row whose
   `parent_id` points at a deleted row is re-parented to the deleted row's
   **nearest surviving ancestor** (recursive walk through deleted rows).
   Splice-out preserves the chain order of historically interleaved thoughts
   (pre-side-lane data has title/planner steps interleaved on the spine) — no
   phantom branches, no lineage skips.
5. Remap `conversations.default_view_leaf_entry_id` and
   `conversations.forked_from_entry_id` through the same mapping.
6. Orphan fixture rows (action with no group) convert in place, best effort.

`inputJson` snapshots keep whatever `leafEntryId` they stored; a copied
snapshot pointing at the fork source hydrates through the source's lineage —
identical prompt (thought rows fold to nothing) and identical to today's
carry-forward behaviour.

## What gets deleted

- Contract/mapper/protocol: `ThoughtPrepareEntrySchema`, `ThoughtStreamEntrySchema`,
  `ThoughtActionEntrySchema` (+ frontend mirrors).
- Repo: `appendThoughtPrepareEntry` / `appendThoughtStreamEntry` /
  `appendThoughtActionEntry` / `updateThoughtAction` → one `appendThoughtEntry`
  + payload merges.
- `ThoughtProcessingService.resolveProviderForThought` (list-scan by
  thoughtId) — the row names its provider.
- Frontend `thoughtTriplets.ts` stitching, triplet-partial rendering states.

## Phases

1. **Backend flip**: contract → mapper → repo → ThoughtContext/steps/service →
   providers → planner prompt folding → processor/controllers.
2. **Migration** (T8) + migrate dev DBs.
3. **Frontend**: protocol union, ThoughtRow (from ThoughtTripletRow),
   detail panel, branch preview/labels, session store, reprocess API calls.
4. **Tests + docs**: e2e page object + affected specs, integration specs,
   `ARCHITECTURE.md`, `chat-entry-data-model.md`.

Lands as one atomic commit — the type flip is cross-stack; intermediate states
can't be suite-green.

## Implementation notes (post-landing)

- The migration was validated against a copy of a real pre-merge DB
  (661 → 341 rows) with a chain-equivalence check: every root-to-leaf chain,
  reduced to visible entries, is byte-identical before/after, and the number
  of spine fork nodes is unchanged (no phantom branches from splice-out).
  Synthetic reason-fork + interleaved-title chains verified the fork
  re-parenting and ordering rules.
- Known accepted gap: `inputJson` snapshots of *summarize* thoughts can embed
  range-bound entry ids; if such a bound was a triplet row, hydrating that
  old snapshot on reprocess fails with "range endpoint missing" (same failure
  class as any stale id). Checkpoint-summary payload bounds ARE remapped; the
  string-embedded snapshot copies are not worth SQL string surgery.
- `ThoughtContext` now carries a single `thoughtEntryId`; `thoughtId` left the
  contract entirely (stale payload keys are stripped by the mapper).
- Reprocess-context of a `summarize_attachment` thought used to create a
  stream row without the mapper-required `attachmentId` (latent, unreachable
  in UI); forks now copy the per-thoughtType extras from their source, fixing
  it by construction.
