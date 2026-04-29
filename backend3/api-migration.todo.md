# API Migration Checklist (backend -> backend3)

## Mounted Routers in old backend

- `GET /health`
- `GET /api/types/ping`
- `GET /api/tools`
- `GET /api/stream`
- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:agentId`
- `PUT /api/agents/:agentId`
- `DELETE /api/agents/:agentId`
- `GET /api/model-presets`
- `POST /api/model-presets`
- `GET /api/model-presets/:presetId`
- `PUT /api/model-presets/:presetId`
- `DELETE /api/model-presets/:presetId`
- `GET /api/settings/llm`
- `GET /api/settings/llm_provider`
- `PUT /api/settings/llm_provider`
- `POST /api/settings/llm_provider/test_connection`
- `GET /api/settings/model_capabilities`
- `PUT /api/settings/model_capabilities/override`
- `POST /api/uploads`
- `GET /api/uploads/:uploadId/content`

## Conversations Router endpoints

### Implemented in backend3

- `GET /conversations`
- `POST /conversations`
- `PUT /conversations/:conversationId`
- `DELETE /conversations/:conversationId`
- `POST /conversations/:conversationId/undelete`
- `DELETE /conversations/:conversationId/permanent`

### Added but still placeholder (501)

- `POST /conversations/:conversationId/messages`
- `POST /conversations/:conversationId/active-leaf`
- `POST /conversations/:conversationId/tool-invocations/:entryId/approve`
- `POST /conversations/:conversationId/cancel-processing`
- `POST /conversations/:conversationId/thoughts/:entryId/reprocess-reason`
- `POST /conversations/:conversationId/thoughts/:entryId/reprocess-context`

### Added but empty response

- `GET /conversations/:conversationId/messages` (currently returns `[]`)

## Implemented non-core `/api` endpoints

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:agentId`
- `PUT /api/agents/:agentId`
- `DELETE /api/agents/:agentId`
- `GET /api/settings/llm`
- `GET /api/settings/llm_provider`
- `PUT /api/settings/llm_provider`
- `POST /api/settings/llm_provider/test_connection`
- `GET /api/model-presets`
- `POST /api/model-presets`
- `GET /api/model-presets/:presetId`
- `PUT /api/model-presets/:presetId`
- `DELETE /api/model-presets/:presetId`
- `GET /api/settings/model_capabilities`
- `PUT /api/settings/model_capabilities/override`
- `GET /api/stream`
- `GET /api/types/ping`
- `GET /api/tools`
- `GET /health`
- `POST /api/uploads`
- `GET /api/uploads/:uploadId/content`

## Missing entirely in backend3

- none
