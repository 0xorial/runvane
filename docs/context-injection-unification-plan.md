# Context-injection unification plan

Status: IMPLEMENTED 2026-07-15. Structural merge in `8f53406` (contract +
mapper + repo + consumers + two-UPDATE migration + unified `ContextRow`); the
RAG→Context/Knowledge vocabulary rename followed. The `rag` tool, `/settings/rag`
slug, `/api/rag/*` paths, query keys, `chat-rag-*`/`retrieval-*` testids, and the
internal `source` values (`files`/`rag`) are unchanged — this was a concept +
entry-type change, not an identifier sweep.

## Why

"RAG" is jargon, and — the deeper point the user made — **forced retrieval and
context-file preinjection are the same thing**: both are the harness injecting
extra context onto the spine, right after the user message, before the planner
plans. They differ only in *source*:

- **files** — context files discovered in the workspace (READMEs, manifests,
  lint configs). Today the `context-injection` entry.
- **rag** — semantic chunks pulled from knowledge storages. Today the
  `retrieval` entry.

So they become one entry family, "**context injection**", discriminated by
`source`. The `RetrievalEntry` schema was already built for this — its comment
says "future grounding sources reuse this entry type with another source, not a
new entry kind." We're cashing that in.

Vocabulary splits into two concepts, renamed coherently:
- **Context injection** — the act (composer control + transcript rows). Replaces
  "RAG"/"retrieval" wording.
- **Knowledge** — the indexed sources you configure in settings (already the
  name of the settings *group*). Replaces "RAG storages".

The model-invoked `rag` tool is a separate path (a tool-invocation, not a spine
entry) and is out of scope structurally; only its human-facing description is
reworded.

## Unified model

One entry type `context-injection`, discriminated on `source ∈ {files, rag}`,
following the established thought-merge pattern (single object schema with
source-specific fields optional; the mapper enforces the per-source shape via a
strict sub-schema keyed on `source`):

| field | source=files (was context-injection) | source=rag (was retrieval) |
| --- | --- | --- |
| `files: PreinjectedFileRecord[]` | ✓ | — |
| `content: string` | ✓ | — |
| `state: pending\|done\|failed` | — | ✓ |
| `queries: RetrievalQuery[]` | — | ✓ |
| `storages: string[]` (display names) | — | ✓ |
| `hits: RetrievalHit[]` | — | ✓ |
| `error?: string` | — | ✓ (failed) |

Internal identifiers stay as-is: `source` values `'files'`/`'rag'`, the
`RagOverride`/`RetrievalEntry` type names, the `rag` tool id, the `/settings/rag`
slug, `/api/rag/*` paths, query keys, and all testids. This is a UI-concept +
entry-type change, not an identifier sweep — renaming those is churn with no user
benefit and breaks stored agent tool configs keyed on `rag`.

## Invariants the maps flagged that we MUST preserve

1. **Spine sequence & anchoring.** user-message → context-injection → retrieval →
   planner, threaded by the `spineTip` parentId chain; the planner reads them by
   walking parent lineage UP and folds them in `conversation_index` order
   (`[Project context files]` before `[retrieved context]`). We change only the
   *type string* of these entries, never when/how they're inserted, so this is
   preserved by construction.
2. **Schema-completeness / snapshot mappability.** Every committed state must map
   (`assertServableRow` re-parses on every write). The migration MUST stamp
   `source:'files'` on old context-injection rows, or they fail the contract and
   dead-stream SSE (the attachment-flake class of bug).
3. **Single planner-start owner.** Three owners (direct, preplanned `onPlanned`,
   summarize-attachment barrier) stay mutually exclusive; the preplanned+summary
   combination stays forbidden→degrades to verbatim. Untouched — we don't move
   the producers.
4. **Reprocess = replay.** Resolved `content`/`hits` live in the immutable
   payload; no re-scan/re-retrieve. Untouched.
5. **Preview ≡ reality.** `ForcedRetrievalService.run` + `formatRetrievalContext`
   stay the single source for both the composer preview and the planner block.
   Untouched.
6. **Failure stays visible.** A failed/zero-hit retrieval and skipped-file audit
   still append an entry and advance the turn. Preserved.

## Phases

### Phase 1 — backend contract + mapper + consumers (one commit)
- `contracts/chatEntry.ts`: collapse `ContextInjectionEntrySchema` +
  `RetrievalEntrySchema` into one `type:'context-injection'` schema with `source`
  + the superset fields (source-specific ones optional). Keep `RetrievalEntry`
  /`ContextInjectionEntry` as exported narrowed TS types for call sites.
- `chat-entry.mapper.ts`: fold cases `'context-injection'` and `'retrieval'`
  into one, dispatch on `payload.source` to `FilesPayloadSchema` /
  `RagPayloadSchema` (strict), return the narrowed entry.
- `chat-entries.repo.ts`: `appendContextInjection` stamps `source:'files'`;
  `appendRetrievalEntry`/`completeRetrievalEntry` emit `type:'context-injection'`
  (payload already has `source:'rag'`).
- Consumer switches, in lockstep (exhaustive `never` guards will catch misses):
  `plannerPrompt.ts` (`entryToMessages`, `renderTurnsForSummary`),
  `summarizeProvider.ts`. Dispatch on `source` inside the one type case.
- `backend/src/tools/builtins/rag/tool.ts`: reword `getHumanDescription` to
  "Search knowledge bases…" (id stays `rag`).
- Backend `tsc` + unit green.

### Phase 2 — migration (same commit as phase 1, applied to rv-dev)
Hand-written `backend/prisma/migrations/20260715xxxxxx_context_unify/migration.sql`
(sqlite; never prisma auto-diff — it drops raw-SQL-only state):
```sql
-- old context-injection (files) rows: stamp the source discriminant
UPDATE chat_entries
  SET payload_json = json_patch(payload_json, json_object('source','files'))
  WHERE type = 'context-injection' AND json_extract(payload_json,'$.source') IS NULL;
-- retrieval rows fold into the unified type (payload already has source='rag')
UPDATE chat_entries SET type = 'context-injection' WHERE type = 'retrieval';
```
Order-independent (first keys on missing source, second on the old type). Apply
to the rv-dev dev DB with rv-dev stopped (sqlite lock); test DBs rebuild from
migrations; rv-stable's real DB migrates on its next update (recommend backup).

### Phase 3 — frontend (same commit)
- `protocol/chatEntry.ts`: re-export the unified type (+ narrowed helpers).
- New `rows/ContextRow.svelte`: one collapsible card, dispatch on `entry.source`
  for icon/summary/details. Preserve BOTH existing testids source-derived
  (`data-testid = source==='files' ? 'context-injection-row' : 'retrieval-row'`)
  and `retrieval-summary`/`retrieval-hit`/`retrieval-query-origin` so e2e holds.
- `ChatMessageRow.svelte`: one `context-injection` case → `ContextRow`.
- `branchPreview.ts`: unify the two preview branches on `source`.
- Delete `RetrievalRow.svelte` + `ContextInjectionRow.svelte`.
- `npm run check` green.

### Phase 4 — vocabulary (separate commit)
RAG → Context / Knowledge across user-facing strings (map has exact
path:line list):
- **Composer** `RetrievalActionBar.svelte`: chip "RAG" → "Context"; HINT; "no
  storages configured — set up RAG ↗" → "no knowledge bases — set one up ↗";
  the explainer strings.
- **Transcript** unified in `ContextRow`: files → "Injected N context file(s)";
  rag → keep "Retrieved N excerpt(s)" (informative) under the Context umbrella.
- **Settings** `SettingsSidebar`/`Overview`/`Header`: "RAG storages" →
  "Knowledge"; role sentences reworded; overview prose.
- **SetupGuide**: "RAG storage" → "knowledge base"; "RAG and presets" →
  "knowledge and presets".
- **AgentPreinjectSettings**: reframe "Context file preinjection" as the *files*
  source of context injection; drop the "context-injection" slug mention.
- `RagStoragesSection.svelte` header already lost its title in the settings
  regroup; keep "storage" as the unit noun (neutral), drop any "RAG".

### Phase 5 — tests, docs, suite, commit
- Update `08-rag.spec.ts` / `18-context-injection.spec.ts` label assertions to
  match (testids preserved, so selectors mostly hold); update
  `ChatTranscript.ts` page-object expected-types if it enumerates
  `retrieval`/`context-injection`.
- Unit: mapper round-trips both sources; a `source:'files'` row without other
  fields maps; a `pending` rag row maps.
- Update `docs/chat-entry-data-model.md`, `docs/rag-revamp-plan.md` (mark the
  entry-type section superseded), this doc → IMPLEMENTED.
- Full suite green (unit + integration + e2e), verify live on rv-dev
  (context-file inject + forced retrieval both render as Context rows), commit.

## Decisions

- **Unified type name = `context-injection`** (the user's word; reuses the
  existing slug so context-injection rows don't change type, only retrieval
  does).
- **Keep internal `source` values `files`/`rag`** and all identifiers — rename
  the *concept* in the UI, not the code's vocabulary. Avoids a third migration
  and rippling into the rag-tool/override code.
- **One `ContextRow` component**, testids preserved source-derived, so the two
  e2e suites keep passing.
- **Knowledge = the sources, Context injection = the act** — two coherent nouns
  replacing one confusing acronym; "Knowledge" already exists as the settings
  group.
- **rag tool structurally untouched** — it's a tool-invocation, not a spine
  grounding entry; only its description is reworded.
