# Layer 3 — The thought pipeline & the `ThoughtType` architecture

**The choice.** Every framework-managed LLM cycle — planning, title generation,
tool-param resolution, summarization, guardrail checks, categorization — is a
**"thought"** run through **one shared three-step pipeline** (prepare → reason →
decision). Each *kind* of thought is a **`ThoughtTypeProvider`** plugged into a
registry. The kind is carried by a `thoughtType` discriminant on a single
`thought_stream` entry type, **not** by proliferating chat-entry types. Re-running
a thought is a **sibling branch**, never a mutation.

This is the example the project owner called "even lower level" than SSE — and it's
where §0.3 "orchestrate, don't abstract" becomes machinery.

Sources: `definitions.md:14-37`, `thoughtProcessing/types.ts`,
`thoughtProcessing/thought-processing.service.ts`, `thoughtProcessing/steps/*`,
`thoughtProcessing/thoughtTypeProviders/*`, `contracts/chatEntry.ts:141-182`.

---

## A thought is three persisted stages

From `definitions.md:14-37`, a thought is deliberately decomposed so each stage is
individually visible and re-runnable:

1. **Context preparation** — build the model input from history + runtime params.
   Persisted as a `thought-prepare` entry whose `requestText` is the *exact* LLM
   request as JSON.
2. **LLM query** — send it; stream the raw output. Persisted as a `thought_stream`
   entry (`llmRequest`, `llmResponse`, tokens, cost).
3. **Framework interpretation** — turn the model text into a structured next action
   (user response / tool calls / error). Persisted as a `thought-action` entry.

These map one-to-one to `steps/prepareStep.ts`, `steps/reasonStep.ts`,
`steps/decisionStep.ts`. The orchestrator (`thought-processing.service.ts:144-165`)
runs them in sequence inside a spawned task and, importantly, **each step creates
its own entry lazily** — no placeholder rows (Layer 3 DAG, invariant #4).

## The discriminant is `thoughtType`, not the entry type

This is the crux of the design and it's documented at the schema
(`contracts/chatEntry.ts:141-156`):

> "The kind of framework LLM cycle a thought stream represents. This — not the
> chat-entry `type` — is the discriminant for which provider produced a stream
> entry. **Adding a new thought is one value here + one provider, with no new entry
> type rippling through the contract, mapper, repo, and frontend union.**"

```ts
// contracts/chatEntry.ts:147-156
export const ThoughtTypeSchema = z.enum([
  'planner', 'title', 'tool_params', 'summarize',
  'summarize_attachment', 'guardrail', 'categorize',
]);
```

So there is **one** `thought_stream` entry type (`chatEntry.ts:169-182`) carrying a
`thoughtType`, with per-kind optional extras (e.g. `parseResult` for planner;
`attachmentId`/`summaryText` for `summarize_attachment`). Contrast the alternative
— a distinct entry type per kind — which would force every switch in the contract,
the mapper, the repo, and the frontend union to grow a case each time. The
`thoughtType` discriminant localizes the change to two files.

## One provider per kind

`ThoughtTypeProvider<TInput>` (`thoughtProcessing/types.ts:64-105`) is the plug-in
contract. A provider supplies:

- `thoughtType`, `prepareTitle` — identity/labels.
- `buildInputFromConversation(conversationId, leafEntryId)` — build typed input by
  walking lineage **from the run's leaf**, not the conversation's default view
  (comment at `types.ts:64-75` warns that re-resolving the default leaf would let a
  concurrent branch/UI switch "poison the run's input").
- `runPrepare(input) → LlmRequest` — the display/edit surface *is*
  `JSON.stringify` of this, so "what you see is exactly what hits the wire"
  (`types.ts:80-83`).
- `runDecision(input, ctx, completion, scope)` — interpret the output into DB
  effects.
- optional hooks: `streamEntryExtraPayload`, `onLlmEvent`, `onThoughtSettled`.

The seven providers are registered in a list
(`thought-processing.service.ts:55-63`): `autoTitle`, `categorize`, `planner`,
`toolParams`, `summarize`, `summarizeAttachment`, `guardrail`. A run is dispatched
by `startThought({ provider, anchorParentId, lane, llm, … })`
(`thought-processing.service.ts:120-166`).

### The `onThoughtSettled` guarantee

Fires from the spawn `finally` for **every** run, success or throw
(`types.ts:98-104`, `thought-processing.service.ts:161-163`). It exists so
per-batch barriers/latches release even when a sibling fails mid-pipeline — no
deadlocked peers. This is §0.1 (a failure must not silently strand others) turned
into a lifecycle contract.

## Reprocess = deterministic replay onto a new branch

Because a thought's *input* is persisted (`inputJson` on the prepare entry,
`thought-processing.service.ts:150-156`), the framework can re-run any thought with
an edit and root the result as a **sibling** of the original:

- **`startReprocessContext`** — edit the prompt (or just swap the model). Parses the
  edited request *eagerly* so a malformed edit fails the API call before any chain
  mutation (`:209-210`, a §0.1 fail-fast), then anchors a fresh
  prepare+stream at the source prepare's parent (`:228-252`).
- **`startReprocessReason`** — hand-edit the model's response text; branches a fresh
  stream+action at the source's prepare entry (`:254-290`).

A subtle model-override rule lives here too: `downstreamLlm` normally equals `llm`,
but a "try this model — just this call" reprocess runs *this* thought on the
override while the downstream continuation reverts to the inherited model
(`types.ts:26-37`, `thought-processing.service.ts:236-239`).

## Model output is parsed by a syntax-sniffing engine

`runDecision` for the planner must turn possibly-messy model text into a structured
`AgenticPlannerOutput`. Models are unreliable about emitting one agreed format, so
instead of hard-coded "try A then B", there's a **generic syntax selector**: a set
of `SyntaxProvider`s each sniff (possibly-partial) text, report
`Match`/`NoMatch`/`Incomplete` with a confidence, and the selector locks onto the
best (`thoughtProcessing/syntax/types.ts:1-96`). Eleven planner dialects are
registered — JSON, function-call JSON, Gemma, tool-call tags, Mistral, Llama,
DeepSeek, DSML, Cohere, Anthropic-invoke, plaintext catch-all — ranked by
confidence then priority (`lib/plannerSyntax/index.ts:37-59`). Supporting another
dialect is "a two-line change: write a `defineSyntax` provider … and add it to the
`register(...)` call." This is §0.4 (vendor-neutral) at the parsing layer.

## What it forbids

- **Don't add a chat-entry `type` for a new thought kind.** Add a `ThoughtType`
  enum value + a provider.
- **Don't build a thought's input from the conversation's default-view leaf.** Walk
  from the run's own `leafEntryId` (concurrency-safety, `types.ts:64-75`).
- **Don't mutate a past thought in place to "redo" it.** Reprocess as a sibling
  branch.
- **Don't hide the request.** The prepare entry's JSON must be the literal wire
  payload.
