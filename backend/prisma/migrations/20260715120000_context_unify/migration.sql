-- Context-injection unification: fold the `retrieval` entry type into the
-- `context-injection` entry family, discriminated by a `source` field.
--
-- Two spine grounding entries were structurally twins ("inject context before
-- the planner, right after the user message"), differing only in source:
--   * old `context-injection` rows  = context files  -> source 'files'
--   * old `retrieval` rows          = knowledge chunks (already carry source 'rag')
-- This is a 1:1 in-place type rename, NOT a collapse: no row is deleted,
-- re-parented, or re-indexed, and no anchor (default_view_leaf, forked_from,
-- checkpoint summarizedRange) references these by anything but their stable ids.
--
-- Hand-written on purpose (see docs/chat-entry-data-model.md + the sqlite
-- migration memory): prisma migrate's auto-diff on chat_entries silently drops
-- raw-SQL-only payload state. json_patch/json_object are the RFC-7386 additive
-- primitives the thought-merge migration uses.
--
-- Order-independent: (1) keys on the OLD context-injection rows that lack a
-- source; (2) keys on the OLD retrieval type. Stamping source:'files' is
-- MANDATORY, not cosmetic — every read and future write re-parses the row via
-- the mapper (assertServableRow), and a files row without `source` fails the
-- unified contract and would dead-stream SSE.

-- (1) Old context-file rows: stamp the source discriminant they never had.
UPDATE chat_entries
SET payload_json = json_patch(payload_json, json_object('source', 'files'))
WHERE type = 'context-injection'
  AND json_extract(payload_json, '$.source') IS NULL;

-- (2) Retrieval rows fold into the unified type (payload already has source='rag').
UPDATE chat_entries
SET type = 'context-injection'
WHERE type = 'retrieval';
