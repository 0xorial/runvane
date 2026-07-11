# Layer 3 — The LLM provider abstraction

**The choice.** Domain code speaks **one canonical, provider-agnostic I/O model**
(`LlmRequest` in, `LlmCompletion`/`LlmStreamEvent` out). Per-vendor **adapters**
translate that model to and from each wire format. `model` is deliberately *not*
part of the request — model selection is resolved separately and stamped by the
adapter. Output that arrives in messy or vendor-specific markup is normalized by
the syntax selector (see [Layer 3 — thoughts](06-thought-pipeline.md)).

This is §0.4 (vendor-neutral) made into a type. It's what lets the planner, title,
guardrail and summarize thoughts all be provider-blind.

Sources: `llmProviders/types.ts`, `llmProviders/provider.ts`,
`llmProviders/registry.ts`, `llmProviders/providers/*`,
`llmProviders/expandAttachments.ts`.

---

## The canonical model

`llmProviders/types.ts:1-11` states the intent:

> "Provider adapters translate this canonical model to/from each wire format
> (OpenAI Chat Completions, Anthropic Messages, Gemini, raw text endpoints, etc.).
> **Domain code never deals with provider-specific shapes.**"

The shapes (all Zod, Layer 1):

- **`LlmRequest`** = `messages[]` (+ optional `tools`, `toolChoice`,
  `responseFormat`, `requestParams`). Messages are **multipart**:
  `LlmContentPart` is a 7-way discriminated union — `text`, `image`, `file`,
  `attachment_ref`, `tool_call`, `tool_result`, `thinking`
  (`types.ts:18-43`).
- **`LlmCompletion`** = `parts[]` of `text`/`thinking`/`tool_call`, a
  `finishReason`, optional `usage`, and optional raw provider `rawChunks` for the
  raw-response view (`types.ts:109-119`).
- **Streaming** is a flat event union `LlmStreamEvent`: `text_delta`,
  `thinking_delta`, `tool_call_delta`, `usage`, `finish` (`types.ts:102-107`). The
  adapter accumulates tool-call arg fragments and JSON-parses at completion.

Helper selectors (`getCompletionText`, `getCompletionThinking`,
`getCompletionToolCalls`, `types.ts:134-157`) keep consumers from re-implementing
part-filtering.

## `model` is intentionally absent from the request

Called out twice (`types.ts:65-76`):

> "`model` is intentionally NOT part of this type — model selection is resolved
> separately (LlmRef / provider settings) and stamped onto the wire body by the
> provider adapter."

`LlmRef = { providerId, model }` is threaded through the thought pipeline
(`ThoughtContext.llm` / `downstreamLlm`), resolved once per run
(`thought-processing.service.ts:90-106`). Separating *what to say* from *who says
it* is what makes the "try a different model for just this call" reprocess a clean
override rather than a request rewrite (Layer 3 — thoughts).

## `attachment_ref`: a metadata-only reference, expanded at the last moment

A stored upload is carried through requests as a lightweight `attachment_ref`
(id + mime + filename + size — **never raw bytes**), so `requestText` stays small
on the wire, in the SSE stream, and in the prepare-entry editor. The reason step
expands each ref into a real `image`/`file` part *right before* calling the adapter;
adapters never see the ref kind (`types.ts:26-39`,
`llmProviders/expandAttachments.ts`, used at `steps/reasonStep.ts:7`). This keeps
the transparent-runtime surfaces readable while still sending ground-truth bytes to
the model — a §0.3 transparency vs. §0.4 fidelity balance.

## Adapters and the stub

Providers implement a common `LlmProvider` interface (`llmProviders/provider.ts`)
and register in `LlmProviderRegistry`. Shipped adapters:
`openAiCompatible`, `openRouter` (+ generation-cost lookup), `lmStudioNative`, and
the **`stubLlm`** used by tests/demos (`llmProviders/providers/*`).

The stub is itself a design artifact worth noting: it implements the *same*
`LlmProvider` interface plus a `StubLlmControl` for scripting responses per model,
so tests exercise the real pipeline with deterministic output
(`providers/stubLlm.ts`, `providers/stubLlm.control.ts`) — see
[Layer X — testing](09-testing-and-dev-infra.md).

## Cost & usage are provider-reported but normalized

`LlmUsage` carries `promptTokens`/`completionTokens`/`cachedPromptTokens`/optional
`costUsd` (`types.ts:81-88`). Where a provider reports real cost (e.g. OpenRouter's
`usage.cost`) it's captured; where it doesn't, the conversation total is flagged a
lower bound (`Conversation.providerCostPartial`, `schema.prisma:24-25`) rather than
silently pretending precision — §0.1 again (don't fake data you don't have).

## What it forbids

- **No provider-specific shape in domain code.** If the planner or a step touches
  an OpenAI/Anthropic/Gemini-shaped object, that's a leak — it belongs in an
  adapter.
- **No `model` baked into `LlmRequest`.** Resolve via `LlmRef` and stamp in the
  adapter.
- **No raw attachment bytes in `requestText`/SSE.** Carry `attachment_ref`; expand
  at reason time.
- **No inventing a cost you didn't get.** Mark it partial.
