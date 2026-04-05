# ADR 0001: Single-process runtime with thin Hono API

Status: Accepted
Date: 2026-03-25

## Context

`backend` is an early migration target from Python to TypeScript. We need:

- Shared TypeScript API/SSE types with frontend.
- Reliable SSE streaming for conversation live updates.
- Agent orchestration that can run in background without blocking request handlers.
- Minimal operational complexity while the system is still evolving.

## Decision

Use a **single Node process** with clear internal runtime boundaries:

- **API layer** (`src/api.ts`, `src/routes/*`) is thin: validate/map HTTP and enqueue work.
- **Runtime composition** (`src/bootstrap/runtime.ts`) wires services.
- **Background execution** uses an in-process queue (`src/infra/inMemoryJobQueue.ts`).
- **Orchestration** lives in domain service (`src/domain/agentOrchestrator.ts`).
- **Live updates** via in-process hub (`src/events/conversationEventHub.ts`) and SSE routes.
- **Persistence** uses SQLite + SQL migrations (`migrations/*.sql`, `src/infra/db/migrate.ts`).

## Rationale

- Keeps development speed high (no external queue/broker required yet).
- Enforces separation of concerns now, so runtime roles can be split later.
- Aligns with requirement: API should be an interface, not orchestration host.
- Enables frontend type reuse immediately through TypeScript contracts in `src/types`.

## Consequences

### Positive

- Clear architecture with low operational overhead.
- Deterministic local setup and migration flow.
- No throw-based route control flow (prefer discriminated union results).

### Negative

- In-memory queue/hub are process-local (not horizontally scalable).
- Process crash loses queued in-memory jobs and hub state.
- Requires future extraction to external queue/event backbone for scale.

## Exit criteria for future split

Move to multi-process + external queue/event bus when one or more happens:

- Need multiple API replicas.
- Queue depth/latency under sustained load becomes unstable.
- Need durable job retries/visibility/DLQ.
- Need cross-instance SSE fanout and replay.
