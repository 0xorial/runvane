# backend (Hono, single-process runtime)

`backend` is a TypeScript/Hono scaffold where HTTP is a thin interface to an in-process agent runtime.

## Architecture

- `src/api.ts` — API composition and router mounting.
- `src/routes/` — HTTP route modules (`conversations`, `health`, `system`).
- `src/bootstrap/runtime.ts` — runtime wiring.
- `src/infra/inMemoryJobQueue.ts` — in-process queue.
- `src/domain/agentOrchestrator.ts` — background orchestration logic.
- `src/events/conversationEventHub.ts` — typed pub/sub + replay for SSE.
- `src/infra/inMemoryConversationStore.ts` — temporary in-memory message store.
- `src/types/` — shared API/SSE wire contracts.

## Tech decisions

- ADR 0001: `docs/adr/0001-single-process-runtime.md`

## Database + migrations

- DB path: `BACKEND2_DB_PATH` (default `./data/backend.db`)
- Migrations folder: `backend/migrations/`
- Runner: `src/infra/db/migrate.ts` (`npm run migrate`)
- Current schema: `0001_init_conversations.sql` with table `conversations`

## Scripts

- `npm run dev` — run Hono server on `:8001`
- `npm run migrate` — apply pending SQL migrations
- `npm run typecheck`
- `npm run build`

## Shared types usage (frontend later)

```ts
import type { SseEvent, PostConversationMessageRequest } from "@runvane/backend/types";
```

## LLM provider settings API

- `GET /api/settings/llm_provider`
- `PUT /api/settings/llm_provider`
- `POST /api/settings/llm_provider/test_connection` (hits `<base_url>/models` and persists verified model list)

## CORS

- Env: `CORS_ALLOW_ORIGINS` (comma-separated), example: `http://localhost:5173,http://127.0.0.1:5173`
- Default (when unset): `http://localhost:5173,http://127.0.0.1:5173`
