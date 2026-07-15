# RAG revamp — plan & architectural notes

> **Superseded (2026-07-15) for the entry model + vocabulary:** the standalone
> `retrieval` chat entry described here was folded into the unified
> `context-injection` entry (discriminated by `source: files | rag`), and the
> user-facing "RAG" wording was renamed to "Context injection" (the act) /
> "Knowledge bases" (the indexed sources). The retrieval *pipeline* (forced
> retrieval, preplanned mode, the `rag` tool, storages) is unchanged. See
> `docs/context-injection-unification-plan.md`.

Restructure the retrieval subsystem around two cleanly separated shapes, delete
the LightRAG sidecar while keeping its two genuinely valuable ideas natively,
and give users a forced-retrieval path that doesn't masquerade as a tool call.

## Background — why

- What we call "RAG" today is really two different things fused: a vector+graph
  index (`backend/src/rag/`) and an agent-invoked retrieval tool
  (`tools/builtins/rag`). The tool shape is *agentic retrieval* (model decides
  when/what to search); classic RAG (system-driven retrieve-then-generate) is a
  different shape with different guarantees. Users sometimes want the classic
  guarantee: "this answer WILL consult my storages."
- The LightRAG dependency is used through a Python sidecar that boots the whole
  library per document (temp workdir, throwaway vector store, dummy embeddings)
  just to run its extraction prompts. ~85% of the library is storage/pipeline
  plumbing we already have better-fitted equivalents for. The valuable parts
  are portable ideas, not code: the extraction prompt + gleaning loop, and the
  incremental entity-merge discipline.
- Retrieval-side sophistication (graph hop-expansion, planned "fanout"
  query-expansion, LightRAG's dual-level keyword retrieval) competes with what
  the agent loop already does natively — iterative reformulated queries. Any
  further investment there is gated on evidence, not built speculatively.

## Decisions

**D1 — Two retrieval shapes, named honestly.** Model-driven retrieval stays a
tool (the `rag` tool). User-forced retrieval becomes a harness-driven pipeline
with its own transcript representation. Neither pretends to be the other.

**D2 — Forced retrieval is recorded as a new chat-entry type, not a tool
invocation.** A tool row asserts "the model chose this"; forced retrieval is
chosen by the user and executed by the harness. New entry type named
generically — `retrieval` with a `source` field (`'rag'` now; attachment
recall / conversation memory later reuse the same type, not a third kind).

**D3 — Two levels, one tail.** `verbatim` (default): zero extra LLM calls, the
user message text is the query. `preplanned`: a rag-planning thought first
turns the message into good storage queries. Decoupling the retrieval entry
from the planning thought is what makes verbatim possible:

```
verbatim:    user msg ──────────────────────────→ [retrieval entry] → decision planner
preplanned:  user msg → [rag-planning thought] ──→ [retrieval entry] → decision planner
```

**D4 — One query schema, two producers.** The retrieval entry's input is
exactly `queries: [{ text, storages?, origin: 'verbatim' | 'planned' }]`.
Verbatim fills it from the message; the planning provider's structured output
IS this shape. Executor and rendering never know which mode ran; UI gets
provenance for free.

**D5 — rag-planning is a ThoughtType, not an entry type.** New value in
`ThoughtTypeSchema` + a provider next to `guardrailProvider`, rendered through
the existing `thought` entry. Planning shapes *how* to retrieve
(queries, storages, top_k), never *whether* — output always ≥ 1 query. Forced
means forced.

**D6 — Delete the LightRAG sidecar; port the two ideas natively.**
- Extraction prompt + gleaning loop ("entities were missed — continue") into
  `LlmGraphBuilder`, with `max_gleaning` as a builder param.
- Entity merge: replace longest-description-wins (`rag-store.ts` node upsert)
  with accumulate-distinct-descriptions + LLM-summarize past a length
  threshold — the discipline that keeps an incrementally grown graph coherent.
- Remove `lightrag-graph-builder.ts` + spec + `backend/python/` sidecar + venv
  bootstrap. One graph builder remains.

**D7 — Retrieval-side upgrades are eval-gated.** No fanout, no dual-level
retrieval until a small eval (real queries via the debug endpoint, `simple` vs
`graph`) shows simple + agent-loop re-querying actually missing things. The
"fanout lands in a later phase" plan is cancelled as a default assumption.

**D8 — Entry writes must be servable at every committed state.** The
`assertServableRow` tripwire (round-trips every payload write through
`rowToChatEntry` + `ChatEntrySchema`) is in place. For the new entry type this
means: the initial INSERT carries everything the schema requires
(`state: 'pending'`, `queries`, `storages`; `hits` defaulted `[]`); the
done-update only fills optionals and flips state. Pending doubles as UI
progress.

**D9 — Cache-safety invariant.** Storage lists and per-agent rag rules are
never rendered into the tool description or system prompt — they live in
server-side rules and message-lane entries only, so mid-conversation storage
changes never invalidate the provider prompt prefix.

**D10 — Forced retrieval is a single-shot composer action, not a policy.**
The control lives in a bar above the message input (not the chat-tools panel):
it applies to the message being composed, resets after send, and is never
re-seeded from conversation history — unlike tool overrides, which are sticky
policy. Because retrieval is cheap, the bar previews interactively while the
user types: a debounced `POST /api/rag/retrieve/preview` runs the SAME code
path a send would (`ForcedRetrievalService`) and formats the SAME planner
block (`formatRetrievalContext`), so the shown "N excerpts · ~X tok" is the
actual injection cost, not an approximation of a different pipeline.

## Retrieval entry contract (sketch)

```ts
{
  type: 'retrieval',
  state: 'pending' | 'done' | 'failed',
  source: 'rag',
  queries: [{ text: string, storages?: string[], origin: 'verbatim' | 'planned' }],
  storages: string[],          // resolved storage ids actually searched
  hits: RetrievalHit[],        // default [] — filled by the done-update
  error?: string,
}
```

- Hits deduped across queries by chunk ref (best score wins) before rendering.
- Zero hits is an explicit, visible outcome (planner sees "retrieval returned
  nothing relevant"; UI shows it) — never silently absent.
- Planner prompt rendering: compact source-attributed block, analogous to the
  tool_result part rendering.

## Composer / overrides

`overrides.rag = { storages: string[], top_k?, mode: 'verbatim' | 'preplanned' }`
on the user message (existing per-message overrides mechanism). Presence of
the key is the force signal. Composer: storage-picker chips in the bar above
the input, single-shot per D10 (reset after send, no re-seeding).

## Phases

1. **Sidecar deletion + native port** (D6). No product surface change.
2. **`retrieval` entry + verbatim path** (D2, D3, D4, D8): contract → mapper →
   repo → frontend union → plannerPrompt rendering; processor path; overrides
   schema + composer chips; e2e (stub embeddings).
3. **rag-planning provider** (D5): additive; `mode: 'preplanned'`. DONE —
   implementation notes: the `rag_planning` thought runs in the side lane
   anchored to the pending retrieval entry (which is appended with
   `queries: []`; the UI shows "Planning retrieval…"); the processor owns the
   continuation (execute retrieval → start planner, scope-spawned and
   once-guarded), and the provider's settle hook delivers `null` on any crash
   so the turn degrades to verbatim instead of stranding — planning shapes HOW,
   never WHETHER. Planning runs on the main agent LLM (grounding quality over
   latency; revisit if it hurts). Preplanned + summary attachments degrades to
   verbatim (the attachment barrier owns the planner start). The composer
   preview stays verbatim in this mode and is labeled approximate (≈).
4. **Tool reframe**: `list_storages` + `read_source` operations; routing
   guidance in descriptions (grep for identifiers/exact strings — semantic
   search for conceptual recall over indexed prose); drop the fanout comment.
   DONE — list_storages returns the agent's storages with live counts/roots as
   a tool RESULT (never in the description, D9), optionally with one storage's
   source listing; read_source re-joins a source's chunks in order (addressed
   by the `source` label hits expose, 24k-char cap with a truncation flag).
5. **Eval, then decide** (D7): graph strategy's fate and any dual-level
   retrieval investment.

## Open questions

- Tool rename (`rag` → `semantic_search`?): RESOLVED — keep `rag`. Agent
  configs key rules under `tools.rag` and a rename buys only a nicer label for
  the price of a config migration; the routing guidance now lives in the tool
  description instead.
- Small-corpus fast path: when selected storages total under N tokens, inject
  everything instead of top-k. Worth doing; N and where it lives (executor vs
  planning provider) TBD.
- Preplanned mode's model choice: RESOLVED for now — the main agent LLM (query
  quality directly bounds grounding quality). Make it configurable if latency
  or cost complaints show up.
