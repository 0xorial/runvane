-- Ground-truth cost aggregate, distinct from the token-based estimate the
-- frontend computes from ModelCapability pricing. Only providers that report
-- cost directly in their response (e.g. OpenRouter's `usage.cost`) contribute
-- here, so this is exact when provider_cost_partial is 0 and a lower bound
-- when it's 1 (some billable turn's provider didn't report a cost).
ALTER TABLE "conversations" ADD COLUMN "provider_cost_total" REAL NOT NULL DEFAULT 0;
ALTER TABLE "conversations" ADD COLUMN "provider_cost_partial" BOOLEAN NOT NULL DEFAULT false;

-- Backfill from history: `provider_cost` has been recorded on thought_stream
-- entries since before these columns existed, so every existing conversation's
-- total starts truthful instead of silently reading 0/exact. Mirrors the same
-- rule ConversationsRepo.addTokenUsage applies going forward.
UPDATE "conversations"
SET
  "provider_cost_total" = COALESCE((
    SELECT SUM(json_extract(ce.payload_json, '$.provider_cost'))
    FROM "chat_entries" ce
    WHERE ce.conversation_id = "conversations".id
      AND (ce.type = 'thought_stream' OR ce.type LIKE '%llm_stream%')
      AND json_valid(ce.payload_json)
      AND json_extract(ce.payload_json, '$.provider_cost') IS NOT NULL
  ), 0),
  "provider_cost_partial" = EXISTS (
    SELECT 1
    FROM "chat_entries" ce
    WHERE ce.conversation_id = "conversations".id
      AND (ce.type = 'thought_stream' OR ce.type LIKE '%llm_stream%')
      AND json_valid(ce.payload_json)
      AND json_extract(ce.payload_json, '$.provider_cost') IS NULL
      AND (
        COALESCE(json_extract(ce.payload_json, '$.promptTokens'), 0) > 0
        OR COALESCE(json_extract(ce.payload_json, '$.completionTokens'), 0) > 0
      )
  );
