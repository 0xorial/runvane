# Layer 0 — Mindset

The convictions below sit above every technology choice. They are not about
NestJS or Svelte or SQLite; they are the reasons those were bent into the shapes
they took. When two lower-level choices conflict, these break the tie.

---

## 0.1 Surface errors; never swallow them

**The choice.** When something is wrong, make it *visible* — throw, log with the
real cause, mark the entry failed — rather than papering over it with a default,
a silent `catch {}`, or a fallback value that hides the fault.

**Why.** Runvane's product promise is a *transparent runtime* (`README.md:26`,
the "Transparent runtime" and "Thought step drill-down" demos). A swallowed error
is a lie told to that UI: the user sees a spinner that never resolves, or a
plausible-looking answer produced from broken state. The whole app is worth less
if you can't trust that what it shows is what happened.

**How it shows up in code.**

- The LLM reason step persists the failure onto the visible entry *and* re-throws
  it — it does not substitute an empty completion:
  `backend/src/thoughtProcessing/steps/reasonStep.ts:63-71` (`setStreamStatus(…, 'failed', detail)` then `throw error`).
- Response validation is a hard failure, not a warning. If a controller returns a
  body that doesn't match its declared schema, the request 500s with the concrete
  Zod issue list rather than shipping a malformed payload:
  `backend/src/validation/response-validation.interceptor.ts:24-32`.
- The HTTP exception filter walks `Error.cause` up to five levels so the *original*
  throw site is logged, not just the NestJS wrapper that hid it:
  `backend/src/http/http-exception-logging.filter.ts:24-46`.
- Even best-effort paths that legitimately swallow do so *loudly and narrowly*,
  with a comment stating why. Context-file injection is explicitly best-effort and
  still logs a warning with the error message: `backend/src/conversations/conversation-processor.service.ts:566-571`.
- Tests enforce it at the process boundary: a run that passes every assertion but
  leaves any exception/warning in its log **fails anyway** (see
  [Layer X](09-testing-and-dev-infra.md), `docs/testing.md:71-82`).

**What it forbids.** A bare `catch {}` that discards the error and continues with
a guessed value. The few empty `catch {}` blocks that exist are all guarding a
genuinely optional read (localStorage, a possibly-absent table) where absence is a
valid state, not an error — e.g. `frontend/src/protocol/runLiveClient.ts:26-30`,
`backend/src/db/stream-cursor.service.ts:28-31`. That is the bar: swallow only
when "it isn't there" is *correct*, never when "it broke" is *inconvenient*.

---

## 0.2 Internal data is trusted; external data is validated

**The choice.** Draw one bright line between *outside* and *inside*. At the
boundary (HTTP request bodies, LLM output, imported files, DB rows crossing back
into the type system) validate hard. Once inside, **trust the shape** — do not
re-check, do not defensively null-guard, do not sprinkle `?.` over values the type
system already guarantees.

**Why.** Defensive null-checks everywhere are a symptom of not trusting your own
invariants, and they *cost* you: they bury the one place a value can legitimately
be absent under fifty places it can't, so real bugs hide among ritual guards. The
discipline is the opposite — establish the invariant once, at the boundary, then
write straight-line code that assumes it holds. If the invariant is ever violated,
that's a *defect*, and per §0.1 it should throw loudly at the mapper, not degrade
quietly three layers deep.

**How it shows up in code.** This is stated verbatim as an architectural
invariant:

> "Everything sourced from the repo (rows, payloads) is trusted shape — we don't
> re-validate `parent_id`, `conversation_index`, payload schemas mid-stack. If a
> row is malformed, the mapper / consumer throws. External boundaries (HTTP DTOs,
> LLM output parsing) are the only places we sanitize."
> — `backend/src/thoughtProcessing/ARCHITECTURE.md:180-185`

- The boundary *in*: the chat-entry mapper is where an untrusted DB payload
  becomes a trusted typed entry. It validates once, and on any mismatch throws
  with a precise context string (`chat_entries[<id>] (<type>)`) — it never returns
  a half-filled object: `backend/src/db/repositories/chat-entry.mapper.ts:25-55`,
  `:249-299`.
- Past that boundary, code indexes into entries by their discriminated `type`
  without re-guarding — see the thought pipeline threading `ctx` fields it knows
  are populated: `backend/src/thoughtProcessing/thought-processing.service.ts:144-165`.
- The frontend does the same on its side of the wire: `client.ts` validates each
  response with the shared Zod validator (`validateGetConversationsResponse`, …)
  and downstream components consume typed entries without re-checking:
  `frontend/src/api/client.ts:26-60`.

**What it forbids.** Adding a `if (!entry) return` or `entry.foo ?? fallback`
in the *middle* of the stack "to be safe". If `entry.foo` can be missing, that
belongs in the schema as optional and is handled at the mapper; if it can't, the
guard is noise that hides the real contract.

---

## 0.3 Orchestrate the runtime; don't abstract it away

**The choice.** Keep every stage of the agentic loop explicit, inspectable, and
individually controllable, even at the cost of more surface area. Prefer an
open, staged pipeline over a closed "just call the model" abstraction.

**Why.** This is the stated identity of the framework, contrasted directly with
MCP:

> "MCP-first mindset: abstract and normalize interactions with models/tools behind
> a common protocol. This framework mindset: keep the runtime explicit and
> controllable at every stage, while still allowing agentic behavior. So, MCP is
> about interoperability; this framework is about orchestration control."
> — `definitions.md:38-46`

**How it shows up in code.**

- A "thought" is deliberately decomposed into three separately-persisted stages —
  context preparation, LLM query, framework interpretation — so each is visible
  and re-runnable: `definitions.md:14-37`, realized as
  `steps/prepareStep.ts` / `reasonStep.ts` / `decisionStep.ts`.
- The prepare entry stores the *exact* LLM request as JSON, and the UI edits that
  JSON: "what you see is exactly what hits the wire"
  (`backend/src/thoughtProcessing/types.ts:80-83`). Nothing is hidden behind an
  opaque client.
- Re-running a stage with an edit produces a new branch instead of mutating the
  past (reprocess-context / reprocess-reason,
  `thought-processing.service.ts:181-290`) — orchestration is not just observable
  but *editable after the fact*.

**What it forbids.** Collapsing prepare/reason/decision into one hidden call, or
routing tools through a normalization layer that erases per-stage control. New
capability is added as *another explicit stage/provider*, not as a smarter black
box.

---

## 0.4 Local-first and vendor-neutral

**The choice.** Keep as much as possible on the user's machine, and never bind the
core to one model vendor's shapes.

**Why.** Stated goals: "keep as much data local as possible", "avoid vendor
lock-in", "customize tools, permissions, and execution flow" (`README.md:9-12`).

**How it shows up in code.**

- SQLite on local disk is the whole database (`backend/prisma/schema.prisma:7-9`);
  a stub/LM-Studio path lets the app run "fully free and offline"
  (`README.md:79-81`).
- The LLM layer is a canonical provider-agnostic I/O model with per-vendor
  adapters, so domain code "never deals with provider-specific shapes"
  (`backend/src/llmProviders/types.ts:1-11`). See [Layer 3 — LLM](08-llm-abstraction.md).
- Model output parsing tolerates *many* vendor dialects rather than demanding one
  (the syntax selector, `backend/src/thoughtProcessing/lib/plannerSyntax/index.ts`).

**What it forbids.** A hard dependency on one provider's request/response schema in
domain code, or storing precious data only in a remote service.

---

These four are the lens. Everything in Layers 1–4 is one of them, made concrete.
