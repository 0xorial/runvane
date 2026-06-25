-- Collapse the six per-thought `*_llm_stream` chat-entry types into a single
-- `thought_stream` type, moving the discriminator into a `thoughtType` field
-- inside payload_json. After this, adding a thought type is one `thoughtType`
-- value + one provider, with no new entry type rippling through the contract,
-- mapper, repo, and frontend union.
--
-- One statement per old type: each writes a literal `thoughtType` (no reliance
-- on SQLite's multi-column SET evaluation order) and rewrites `type`.

UPDATE chat_entries
SET payload_json = json_set(payload_json, '$.thoughtType', 'planner'), type = 'thought_stream'
WHERE type = 'planner_llm_stream';

UPDATE chat_entries
SET payload_json = json_set(payload_json, '$.thoughtType', 'title'), type = 'thought_stream'
WHERE type = 'title_llm_stream';

UPDATE chat_entries
SET payload_json = json_set(payload_json, '$.thoughtType', 'tool_params'), type = 'thought_stream'
WHERE type = 'tool_params_llm_stream';

UPDATE chat_entries
SET payload_json = json_set(payload_json, '$.thoughtType', 'summarize'), type = 'thought_stream'
WHERE type = 'summarize_llm_stream';

UPDATE chat_entries
SET payload_json = json_set(payload_json, '$.thoughtType', 'summarize_attachment'), type = 'thought_stream'
WHERE type = 'summarize_attachment_llm_stream';

UPDATE chat_entries
SET payload_json = json_set(payload_json, '$.thoughtType', 'guardrail'), type = 'thought_stream'
WHERE type = 'guardrail_llm_stream';
