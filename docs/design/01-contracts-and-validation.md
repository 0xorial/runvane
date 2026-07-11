# Layer 1 — One contract layer, Zod as the single shape truth

**The choice.** There is exactly one place where the shape of every wire payload
is defined: `backend/src/contracts/`. Those definitions are **Zod schemas**, and
the **frontend imports them directly from the backend source tree** — the same
file is the server's validator and the client's type. Types are derived from the
schemas (`z.infer`), never hand-written alongside them.

This is the highest-level *technical* convention (Layer 0 is pre-technical). It's
a direct expression of §0.2 "validate at the boundary": the contract layer *is*
the boundary, written once.

---

## Why

A typed client and a typed server that maintain *separate* copies of the wire
shape drift the moment someone edits one side. Runvane removes the second copy
entirely. If the backend changes `ChatEntrySchema`, the frontend either recompiles
against the new type or fails to compile — there is no stale mirror to forget.

Zod (not bare TypeScript types, not JSON Schema) is chosen because it is
simultaneously three things the codebase needs:

1. a **runtime validator** (server request/response, DB payloads, SSE frames),
2. a **static type** via `z.infer`, and
3. a **serializable schema** that can be shipped to the client and even to the LLM
   (tool params advertised as JSON Schema).

One artifact, three consumers — you cannot get that from a plain `type`.

---

## How it shows up in code

### The contracts directory is the source of truth

`backend/src/contracts/` holds `chatEntry.ts`, `conversations.ts`, `sse.ts`,
`llm.ts`, `agents.ts`, `settings.ts`, `guardrail.ts`, … Each defines Zod schemas
and exports both the schema and its inferred type:

```ts
// backend/src/contracts/chatEntry.ts:20-21
export const AttachmentModeSchema = z.enum(['direct', 'summary']);
export type AttachmentMode = z.infer<typeof AttachmentModeSchema>;
```

### The frontend imports backend source directly

Not a generated SDK, not a published package — a relative import across the repo:

```ts
// frontend/src/protocol/chatEntry.ts:1
import type { ChatEntry, ThoughtStreamEntry } from "../../../backend/src/contracts/chatEntry.js";
```

**55 frontend files** import from `backend/src` this way (`api/client.ts`,
`ragClient.ts`, sidebar components, chat composer, settings editors, …). The
frontend even reuses backend Zod schemas as *editor* schemas for its Monaco JSON
editors:

```ts
// frontend/src/lib/editorSchemas.ts:1-2
export { LlmRequestSchema } from "../../../backend/src/llmProviders/types";
export { AgenticPlannerOutputSchema } from "../../../backend/src/contracts/chatEntry";
```

This is the example the project owner cited as a "quite high level" choice, and
it's load-bearing: the SSE union, the chat-entry union, the LLM request shape, and
the tool-run shapes are all defined once and consumed on both sides.

### Validation happens *only* at the three boundaries

**Request in** — DTOs are the same schema wrapped by `createZodDto`; a global
`ZodValidationPipe` enforces them:

```ts
// backend/src/conversations/dto/post-conversation-message.dto.ts:1-4
export class PostConversationMessageDto extends createZodDto(PostConversationMessageRequestSchema) {}
// backend/src/bootstrap.ts:95
app.useGlobalPipes(new ZodValidationPipe());
```

**Response out** — an opt-in decorator attaches a schema to a handler; a global
interceptor validates the body before it leaves and 500s on mismatch (§0.1):

```ts
// backend/src/validation/validate-response.decorator.ts:8-9
export const ValidateResponse = (schema: ZodType): MethodDecorator => SetMetadata(VALIDATE_RESPONSE_KEY, schema);
// backend/src/validation/response-validation.interceptor.ts:22-32  → throws InternalServerErrorException
```

**Data across the DB boundary** — the chat-entry mapper `safeParse`s each payload
sub-object and throws on failure (`chat-entry.mapper.ts:104-118`, `:199-205`).

**The client side of the wire** validates responses with shared validators
(`validateGetConversationsResponse` etc.,
`frontend/src/api/client.ts:26-60`) — the same functions the server could use,
because they live in the shared contract file.

### Even the SSE bus self-validates

The hub `safeParse`s every payload against the discriminated `SsePayloadSchema`
before publishing, logging a precise error if a producer ever emits a malformed
frame: `backend/src/sse/sse-hub.service.ts:15-27`.

---

## The discriminated-union + exhaustiveness pattern

A structural convention that rides on top of the contract layer: every
polymorphic payload is a **Zod `discriminatedUnion`** on a literal `type`/`kind`
field, and consumers switch on that discriminant with a compile-time
exhaustiveness guarantee.

- `ChatEntrySchema` — 8 entry variants on `type` (`chatEntry.ts:272-282`).
- `SsePayloadSchema` — 11 event variants on `type` (`sse.ts:137-150`).
- `LlmContentPartSchema` — 7 content parts on `kind` (`llmProviders/types.ts:18-43`).
- `LlmDecisionSchema`, `PlannerParseResultSchema`, `LlmResponseFormatSchema`, … all
  the same shape.

Exhaustiveness is enforced with a shared helper that turns a missed case into a
throw (and, because its argument is typed `never`, a compile error):

```ts
// frontend/src/utils/assertNever.ts
export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
```

The payoff is the `ThoughtType` design (see [Layer 3](06-thought-pipeline.md)):
adding a new thought kind is *one enum value plus one provider*, and every switch
that must learn about it fails to compile until it does — the discriminated union
turns "did I update all the sites?" from a code-review question into a type error.

---

## What it forbids

- **A second copy of any wire type.** No hand-written frontend interface that
  mirrors a backend response. Import the contract.
- **Validating in the middle.** Don't re-`parse` an already-typed value deep in a
  service. Validation is a boundary event (§0.2).
- **A non-discriminated polymorphic payload.** If a value has variants, it gets a
  literal discriminant and joins a `discriminatedUnion`; consumers switch with
  `assertNever` in the default arm.

---

## Consequences that ripple downward

- Because the wire shape is shared and validated, the **frontend can treat SSE
  frames as trusted once parsed** — it derives all state from them without
  defensive checks (see [Layer 2](02-state-is-derived.md)).
- Because tool param schemas are Zod, they can be `zerialize`d and shipped to the
  client for form rendering *and* converted to JSON Schema for the LLM — one
  definition, three surfaces (`backend/src/tools/base-tool.ts:55-58`).
