# Chat Entry Data Model

This document defines the canonical chat event model for both frontend and backend.

## Goal

Use one conceptual model for chat timeline items, independent from storage details.

- UI renders rows from `ChatEntry.type`
- backend stores data in DB rows, but exposes data that maps cleanly to `ChatEntry`
- avoid DB-specific naming in UI (`segmentKind`, `segmentMeta`) outside adapter layer

## Canonical Types

```ts
type LlmDecision =
  | {
      type: "tool-invocation";
      toolId: string;
      parameters: Record<string, unknown>;
    }
  | {
      type: "user-response";
      text: string;
    };

type ChatEntry =
  | {
      type: "user-message";
      id: string;
      text: string;
      createdAt?: string;
    }
  | {
      type: "planner_llm_stream";
      id: string;
      runId: string | null;
      plannerStepId: number;
      state: "running" | "done";
      thoughtMs?: number;
      decision?: LlmDecision | Record<string, unknown>;
      createdAt?: string;
    }
  | {
      type: "tool-invocation";
      id: string;
      runId: string | null;
      toolId: string;
      state: "requested" | "running" | "done" | "error";
      parameters?: Record<string, unknown>;
      result?: unknown;
      traces?: Array<Record<string, unknown>>;
      createdAt?: string;
    }
  | {
      type: "assistant-message";
      id: string;
      text: string;
      runId?: string | null;
      traces?: Array<Record<string, unknown>>;
      createdAt?: string;
    };
```

## Mapping from DB Rows

Current DB rows (`messages`) map as:

- `role=user` -> `ChatEntry(type="user-message")`
- `segmentKind=thinking` -> `ChatEntry(type="planner_llm_stream")` (same string as SSE `planner_llm_stream`)
- `segmentKind=tool` -> `ChatEntry(type="tool-invocation")`
- `segmentKind=final` -> `ChatEntry(type="assistant-message")`
- plain assistant row without segment kind -> `ChatEntry(type="assistant-message")`

This mapping lives in:

- `frontend/src/utils/chatEntries.ts`

Only that adapter should know DB field names like `segmentKind`/`segmentMeta`.

## Rendering Contract

Timeline UI should switch only on `entry.type`:

- `user-message` -> user row component
- `planner_llm_stream` -> thinking/planner row component (`llm-call` accepted as legacy)
- `tool-invocation` -> tool row component
- `assistant-message` -> final or plain assistant text row component

File using this contract:

- `frontend/src/components/chat/ChatMessageRow.tsx`

## Backend Alignment Rules

When backend writes assistant timeline rows, ensure:

1. Planner row (`thinking`) includes:
   - `runId`
   - `plannerStepId`
   - `pending` while running, then `thoughtMs` and optional `decision` when done
2. Tool row (`tool`) includes:
   - `runId`
   - `toolName`
   - `toolCall` payload when available
3. Final row (`final`) includes:
   - `runId`
   - final answer text in `text`

This guarantees deterministic conversion into `ChatEntry`.

## Migration Direction

Short term:

- keep DB schema as-is
- keep adapter-based translation

Long term:

- backend API may emit `ChatEntry[]` directly
- adapter becomes a no-op passthrough

