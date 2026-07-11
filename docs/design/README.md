# Runvane — Layered Design Choices

A hierarchical reading of *why runvane is built the way it is*, ordered from the
most cross-cutting mindset decisions down to concrete local mechanisms. Each
layer is justified by, and constrains, the ones below it.

This is a **design-rationale** doc, not an API reference. It was reconstructed by
reading the source (`backend/`, `frontend/`, `tests/`, `toolhost/`), the in-repo
architecture notes (`backend/src/thoughtProcessing/ARCHITECTURE.md`,
`docs/chat-entry-data-model.md`, `docs/testing.md`), and the code comments that
record decisions at their call sites. File references use `path:line` and are
clickable.

## How to read this

Read top-down the first time. Each doc opens with **the choice** (one line), then
**why**, then **how it shows up in code**, then **what it forbids** (the invariant
you'd break by ignoring it). If you only want the philosophy, read Layer 0 and
stop.

## The layer map

| Layer | Scope | Doc |
| --- | --- | --- |
| **0 — Mindset** | Convictions that predate any technology choice. Fail loud, trust internal data, orchestrate don't abstract, local-first. | [00-philosophy.md](00-philosophy.md) |
| **1 — Cross-cutting conventions** | One typed contract layer shared client↔server; Zod as the single source of shape truth; discriminated unions + exhaustiveness. | [01-contracts-and-validation.md](01-contracts-and-validation.md) |
| **1 — State substrate** | The DB is the single source of truth; runtime state is *derived*, never held in memory across requests. | [02-state-is-derived.md](02-state-is-derived.md) |
| **2 — System shape** | NestJS modular backend, Svelte derived-state frontend, an SSE spine between them, a detachable tool-host. | [03-system-architecture.md](03-system-architecture.md) |
| **3 — The conversation DAG** | One append-only table, parent-pointer branching, explicit causal anchors, the side lane. | [04-conversation-dag.md](04-conversation-dag.md) |
| **3 — SSE streaming** | Snapshot + live tail, one monotonic watermark, two workhorse events, no replay buffer. | [05-sse-streaming.md](05-sse-streaming.md) |
| **3 — The thought pipeline** | The `ThoughtType` architecture: prepare → reason → decision, one provider per kind, reprocess as sibling branch. | [06-thought-pipeline.md](06-thought-pipeline.md) |
| **3 — Tools & permissions** | Central registry, per-agent policy, fan-in from history, guardrails, harness-vs-target execution. | [07-tools-and-permissions.md](07-tools-and-permissions.md) |
| **3 — LLM provider model** | A canonical multipart I/O model; adapters per wire format; a syntax-sniffing parser for model output drift. | [08-llm-abstraction.md](08-llm-abstraction.md) |
| **X — Testing & dev infra** | A cross-cutting doctrine of its own: run from source, isolated DBs, the zero-tolerance log gate, the stub LLM. | [09-testing-and-dev-infra.md](09-testing-and-dev-infra.md) |
| **4 — Mechanisms** | The small, load-bearing tricks the layers above lean on. | [10-mechanisms-reference.md](10-mechanisms-reference.md) |

## The one-paragraph version

Runvane is a local-first, vendor-neutral AI chat client whose whole reason to
exist is **explicit control over the agentic runtime** (`README.md:5-12`,
`definitions.md:38-46`). Every structural decision serves that: a conversation is
an immutable parent-pointer DAG so nothing is ever destructively rewritten; the
backend derives all workflow state from that DAG so restarts and races can't
corrupt it; a single Zod contract layer is shared verbatim between server and
client so the wire can't drift; the runtime surfaces its own errors instead of
swallowing them so a transparent UI can show what actually happened. The tech
(NestJS, Svelte, SQLite, SSE, Prisma) is downstream of those commitments.
