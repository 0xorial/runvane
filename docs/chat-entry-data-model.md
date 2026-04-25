# Chat Entry Data Model

This doc describes the **actual DB structure** used for chat timeline data.

## Core Table

Chat timeline is stored in `chat_entries` with one row per timeline entry.

Columns:

- `id TEXT PRIMARY KEY` - entry id.
- `conversation_id TEXT NOT NULL` - conversation owner (FK to `conversations.id`).
- `conversation_index INTEGER NOT NULL` - monotonic order inside one conversation.
- `parent_id TEXT` - parent entry id in the conversation tree (logical self-link).
- `type TEXT NOT NULL` - entry type discriminator.
- `payload_json TEXT NOT NULL` - type-specific fields.
- `created_at TEXT NOT NULL` - ISO timestamp.

Conversation linkage:

- `conversations.active_leaf_entry_id` points to the currently active leaf in the branch tree.

## Entry Types In DB

`type` is one of:

- `user-message`
- `assistant-message`
- `planner_llm_stream`
- `title_llm_stream`
- `thought-prepare`
- `thought-action`
- `tool-invocation`

Shared top-level (outside payload) for all entries:

- `id`, `conversation_id`, `conversation_index`, `parent_id`, `type`, `created_at`

## `payload_json` Shapes

### `user-message`

- `text: string`
- `agentId: string`
- optional: `llmProviderId`, `llmModel`, `modelPresetId`
- optional: `attachments[]`

### `assistant-message`

- `text: string`

### `planner_llm_stream`

- `thoughtId: string` (required)
- `llmRequest: string`
- `llmResponse: string`
- `thoughtMs: number | null`
- `decision: object | null`
- `status: "running" | "completed" | "failed" | "cancelled"`
- optional: `error`, `llmModel`, token usage fields (`promptTokens`, `cachedPromptTokens`, `completionTokens`)
- optional: `parseResult`

### `title_llm_stream`

- same core shape as `planner_llm_stream`
- includes `thoughtId` and status/error/token fields

### `thought-prepare`

- `thoughtId: string` (required)
- `requestText: string`
- fixed status semantics: completed prepare step
- optional: `title`, `llmModel`

### `thought-action`

- `thoughtId: string` (required)
- `status: "running" | "completed" | "failed" | "cancelled"`
- optional: `summary`, `action`, `toolName`, `error`, `parseResult`

### `tool-invocation`

- `toolId: string`
- `state: "requested" | "running" | "done" | "error"`
- `parameters: object`
- `result: unknown`

## Relationship Model

There are 2 linkage layers:

- **Tree linkage** via `parent_id` (branch structure and active lineage).
- **Thought grouping** via `payload_json.thoughtId` (ties `thought-prepare` + stream + `thought-action`).

Important:

- `thoughtId` is a logical group key in payload, not a DB foreign key.
- `parent_id` and `active_leaf_entry_id` are logical references (not enforced FK constraints).

## Read Behavior

- Default message fetch returns active lineage only (following `active_leaf_entry_id` through `parent_id` chain).
- `?all=1` returns all entries in `conversation_index` order.

## Probe Time Expected Sequence

For the `what is the time?` probe flow, expected order is:

1. auto title thought (3 steps)
2. planner thought (3 steps)
3. realtime assistant feedback starts streaming
4. tool parameter preparation thought (3 steps)
5. tool call
6. planner thought (3 steps)
7. final assistant feedback streams and completes
