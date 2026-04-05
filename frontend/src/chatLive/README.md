# Global live stream (SSE)

## Routing

- **`ChatPageShell`** (`App.tsx`) handles **`/chat/:conversationId`** with `conversationId === "new"` → `null`.
- **One** React tree for `/chat/new` → `/chat/{uuid}` so the page **does not remount** on first id; EventSource stays attached.

## SSE contract

- **`conversationStreamContract.ts`** — helpers for checking whether a global SSE event belongs to a conversation.
- **`runLiveClient.ts`** subscribes to `GET /api/stream` once and multicasts to UI consumers.
- **`useChatSession.ts`** — applies SSE events directly and owns live chat state updates.

## Polling

- If EventSource fails, **`runLiveClient`** falls back to an interval; chat handlers `pollTick` with **`GET .../messages`** (RV-006).

## HTTP on conversation change

- **`USER_INVARIANT[RV-006]`:** one messages GET when switching chats; runs/steps/approvals from SSE.
