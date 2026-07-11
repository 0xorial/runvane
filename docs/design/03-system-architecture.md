# Layer 2 — System shape

**The choice.** A four-part shape, each part chosen to serve the Layer-0/1
convictions:

```
   Svelte 5 frontend  ──HTTP (request/response)──▶  NestJS backend  ──▶  SQLite (Prisma)
   (derived state)    ◀────────── SSE (live tail) ─────────────         (source of truth)
                                                          │
                                                          └──wire protocol──▶  tool-host
                                                                                (in-proc / child / ssh)
```

- **Backend: NestJS**, one module per bounded capability, DI everywhere.
- **Frontend: Svelte 5 + Vite**, a thin derived-state mirror over TanStack Query +
  a hand-rolled observable collection.
- **The spine between them: SSE**, with plain HTTP for commands.
- **A detachable tool-host**: target tools run behind a transport-agnostic wire so
  they can execute in-process, in a child, or over SSH without a rewrite.

---

## Backend: modules as capability boundaries

`AppModule.register(runtime)` composes ~20 feature modules
(`backend/src/app.module.ts:48-93`). The seams line up with the domain:
`ConversationsModule`, `ThoughtProcessing` (via conversations), `ToolsModule`,
`ToolHostModule`, `LlmProvidersModule`, `RagModule`, `SseModule`, `SettingsModule`,
`AgentsModule`, `ImportModule`, `UploadsModule`, `TerminalModule`, …

Design decisions visible here:

- **The runtime config is a first-class input**, threaded through `forRoot`
  (`RuntimeModule.forRoot(runtime)`, `LlmProvidersModule.forRoot(runtime)`), not
  read from `process.env` scattered across services. `bootstrap.ts` resolves env →
  a typed `RunvaneBootConfig` in exactly one place
  (`backend/src/bootstrap.ts:36-72`).
- **Test wiring is a composition-time decision, not an `if` in the code.** The stub
  LLM harness module is only imported when `nodeEnv === 'test' && llm.mode ===
  'stub'` (`app.module.ts:51`, `:85`) — production can't accidentally expose it.
- **Cross-cutting concerns are global providers/pipes/filters**, registered once at
  bootstrap: the Zod validation pipe, the response-validation interceptor
  (`APP_INTERCEPTOR`), the exception-logging filter, pino request logging
  (`app.module.ts:88-91`, `bootstrap.ts:95-96`). This is where Layer 1's "validate
  at the boundary" is physically installed.
- **The `contracts/` folder is not a module** — it's pure schema, imported by
  everything including the frontend. Keeping it dependency-free is what makes the
  cross-repo import in Layer 1 possible.

A registry pattern recurs wherever a capability has plug-in members: `ToolRegistry`
(`tools/tool-registry.ts`), `LlmProviderRegistry`, the thought-type provider list
(`thought-processing.service.ts:55-63`), the syntax registry. Each enforces
*unique names, no silent replacement* — see `ToolRegistry.register` throwing on a
name collision, with the safety rationale spelled out
(`tools/tool-registry.ts:20-25`).

> **Naming note (memory):** the project prefers *one dispatch tool per capability*
> over fragmenting a capability into per-operation tools — mirror the single
> registry/dispatch shape rather than adding parallel one-off services.

## Frontend: a derived-state mirror, not a second brain

The frontend is deliberately *dumb about workflow* (that lives server-side, Layer
1) and *smart about presentation*. Its architecture:

- **TanStack Query** for reference data (agents, presets, model capabilities,
  settings) — cache-keyed read models: `frontend/src/hooks/queries/*`.
- **A hand-rolled `ObservableItemCollection`** for the live conversation, because
  chat entries need per-entry fine-grained reactivity and SSE-delta mutation that a
  query cache isn't shaped for: `frontend/src/utils/observableCollection.ts`,
  driven by `frontend/src/lib/chatSessionState.svelte.ts`.
- **Svelte 5 runes** (`$state`, `$effect`) for local view state; the session state
  file wires SSE subscription lifecycle to component lifecycle
  (`chatSessionState.svelte.ts:104-130`).
- **A global multiplexed SSE client** shared across the whole app (one connection,
  many subscribers) — see [Layer 3 — SSE](05-sse-streaming.md) for why this is one
  connection and not one-per-view.

Styling is intentionally minimal-rule: Tailwind utilities in components, shared
tokens in `app.css`, UI primitives under `components/ui/`, "avoid feature-specific
global selectors" (`docs/frontend-styling.md`).

## The SSE spine + HTTP commands split

Commands (post message, approve tool, reprocess, edit settings) are plain HTTP and
**return immediately** — the handler does only synchronous prep and never awaits
LLM/tool work (`ARCHITECTURE.md:117-126`, invariant #3). All *progress* comes back
over SSE. This split is what makes the runtime feel live while keeping request
handlers fast and cancellation-safe. Detail in [Layer 3 — SSE](05-sse-streaming.md)
and [the thought pipeline](06-thought-pipeline.md).

## The tool-host split

Target tools (filesystem, exec, …) are factored into a standalone
`@runvane/toolhost` package the harness drives over a `MessageChannel`-shaped wire,
with three interchangeable transports behind one client
(`toolhost/README.md`):

| Mode | Transport | Use |
| --- | --- | --- |
| in-process | `linkedChannels()` | default; zero serialization |
| local child | `spawnChannel(...)` | own OS process |
| external | `connectSsh(...)` | another machine/container |

The rationale is a security *and* topology decision: "the harness stays central (it
holds the API key, talks to the LLM, owns transparency/monitoring) and each target
sandbox runs only a thin tool-host … The target sandbox needs no LLM egress and
holds no precious state — it just executes." Going per-chat or remote later "is a
transport swap, not a rewrite." A `ToolLocation` of `harness` vs `target`
(`tools/base-tool.ts:15`, `:86-93`) is how a tool declares which side it runs on.

## Why these specific technologies

Each is downstream of Layer 0/1, not an independent taste call:

- **SQLite** — local-first (§0.4); the whole DB is a file on the user's disk.
- **NestJS** — its DI + interceptor/pipe/filter model is exactly the right place to
  install "validate at the boundary" and "surface errors" as global concerns.
- **Svelte 5** — fine-grained reactivity matches a derived-state mirror fed by SSE
  deltas.
- **Zod** — one artifact serving runtime validation, static types, and serializable
  schema (Layer 1).
- **Prisma 7 (better-sqlite3 driver adapter)** — engine-free since 2026-07-06; the
  generated client is committed in-tree. The move off the Rust query engine also
  deleted an entire class of deadlock (see
  [mechanisms](10-mechanisms-reference.md#batch-transactions)).
