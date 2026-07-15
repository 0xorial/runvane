-- Rename the "rag" concept to "knowledge" in persisted data, to match the code
-- rename (tool id, payload discriminants). Hand-written (never prisma auto-diff,
-- which drops raw-SQL-only payload state). All four UPDATEs are guarded and
-- idempotent-safe; dev/seed DBs have none of these rows, but rv-stable's real DB
-- does, so they run there on its next update.

-- (1) Forced-retrieval context-injection rows: source discriminant 'rag' -> 'knowledge'.
UPDATE chat_entries
SET payload_json = json_set(payload_json, '$.source', 'knowledge')
WHERE type = 'context-injection'
  AND json_extract(payload_json, '$.source') = 'rag';

-- (2) The retrieval-planning side thought: thoughtType 'rag_planning' -> 'knowledge_planning'.
UPDATE chat_entries
SET payload_json = json_set(payload_json, '$.thoughtType', 'knowledge_planning')
WHERE type = 'thought'
  AND json_extract(payload_json, '$.thoughtType') = 'rag_planning';

-- (3) Per-agent tool config: the tool is keyed by id, so rename the JSON key
-- default_llm_configuration_json.tools.rag -> .tools.knowledge (carrying its
-- rules/policy object). json(...) re-parses the extracted object so it embeds as
-- JSON, not as a quoted string.
UPDATE agents
SET default_llm_configuration_json = json_set(
      json_remove(default_llm_configuration_json, '$.tools.rag'),
      '$.tools.knowledge',
      json(json_extract(default_llm_configuration_json, '$.tools.rag'))
    )
WHERE json_extract(default_llm_configuration_json, '$.tools.rag') IS NOT NULL;

-- (4) Forced-retrieval override on user messages: overrides.rag -> overrides.knowledge.
-- (The schema is non-strict so an un-migrated old key would just be ignored, but
-- rename it for cleanliness.)
UPDATE chat_entries
SET payload_json = json_set(
      json_remove(payload_json, '$.overrides.rag'),
      '$.overrides.knowledge',
      json(json_extract(payload_json, '$.overrides.rag'))
    )
WHERE type = 'user-message'
  AND json_extract(payload_json, '$.overrides.rag') IS NOT NULL;
