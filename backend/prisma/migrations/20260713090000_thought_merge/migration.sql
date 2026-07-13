-- Collapse the thought-prepare / thought_stream / thought-action triplet into
-- a single `thought` entry per thought (docs/thought-merge-plan.md, T8).
--
-- Survivor per triplet group = the prepare row: it keeps its id,
-- conversation_index and created_at, so anchors that point at it stay valid.
-- Reason-fork groups (one prepare with N>1 streams, from reprocess-reason)
-- keep stream #1 merged into the prepare; each later stream transforms IN
-- PLACE into its own sibling thought (forkOf/forkPoint 'reason') re-parented
-- at the prepare's parent — matching where the new runtime forks.
--
-- Every surviving row whose parent was a deleted stream/action re-parents to
-- the deleted row's NEAREST SURVIVING ANCESTOR (recursive walk through
-- deleted rows). This splice-out preserves the chain order of historically
-- interleaved thoughts (pre-side-lane data interleaves title/planner steps on
-- the spine): collapsing a group whose members are non-contiguous must not
-- rewire around the interleaved rows, or old chains grow phantom branches.
--
-- Hand-written (never prisma auto-diff — it silently drops raw-SQL-only
-- state; see docs/chat-entry-data-model.md).

-- Snapshot original parent pointers before any rewiring.
CREATE TEMP TABLE tm_orig_parent AS
SELECT id, parent_id FROM chat_entries;

CREATE TEMP TABLE tm_prepare AS
SELECT id, conversation_id, conversation_index, payload_json,
       json_extract(payload_json, '$.thoughtId') AS thought_id
FROM chat_entries WHERE type = 'thought-prepare';

CREATE TEMP TABLE tm_stream AS
SELECT id, conversation_id, conversation_index, payload_json,
       json_extract(payload_json, '$.thoughtId') AS thought_id
FROM chat_entries WHERE type = 'thought_stream';

CREATE TEMP TABLE tm_action AS
SELECT id, conversation_id, conversation_index, payload_json,
       json_extract(payload_json, '$.thoughtId') AS thought_id
FROM chat_entries WHERE type = 'thought-action';

-- Each stream's position within its (conversation, thoughtId) group, plus the
-- group's prepare row. thought_id NULL (malformed payload) never matches a
-- group -> the row is handled as an orphan below.
CREATE TEMP TABLE tm_stream_ranked AS
SELECT s.id, s.conversation_id, s.conversation_index, s.payload_json, s.thought_id,
       (SELECT COUNT(*) FROM tm_stream s2
         WHERE s2.conversation_id = s.conversation_id AND s2.thought_id = s.thought_id
           AND s2.conversation_index < s.conversation_index) AS rank0,
       (SELECT p.id FROM tm_prepare p
         WHERE p.conversation_id = s.conversation_id AND p.thought_id = s.thought_id
         ORDER BY p.conversation_index LIMIT 1) AS prepare_id
FROM tm_stream s;

-- Pair each action with its stream: the latest group stream before it in
-- chain order (robust against interleaved rows between stream and action).
CREATE TEMP TABLE tm_action_pair AS
SELECT a.id AS action_id, a.conversation_id, a.thought_id, a.payload_json AS action_payload,
       (SELECT s.id FROM tm_stream s
         WHERE s.conversation_id = a.conversation_id AND s.thought_id = a.thought_id
           AND s.conversation_index < a.conversation_index
         ORDER BY s.conversation_index DESC LIMIT 1) AS stream_id
FROM tm_action a;

-- One row per surviving prepare: its first stream (if any) and that stream's
-- action (if any), with the merged-thought fields precomputed.
--   status: the deepest row's status; a 'completed' stream/prepare with no
--   downstream row means the thought never actually finished -> 'cancelled'.
--   thoughtType: from the stream; prepare-only zombies derive it from the
--   prepare title (display-only for them — reprocess of a request-less row
--   fails fast anyway). 'Summarize attachment' zombies map to 'summarize'
--   because the summarize_attachment mapper requires an attachmentId these
--   rows never had.
CREATE TEMP TABLE tm_survivor AS
SELECT p.id AS prepare_id,
       fs.id AS stream_id,
       fs.payload_json AS stream_payload,
       ap.action_id,
       ap.action_payload,
       COALESCE(
         json_extract(fs.payload_json, '$.thoughtType'),
         CASE json_extract(p.payload_json, '$.title')
           WHEN 'Decision planning' THEN 'planner'
           WHEN 'Title generation' THEN 'title'
           WHEN 'Resolve tool parameters' THEN 'tool_params'
           WHEN 'Summarize tail' THEN 'summarize'
           WHEN 'Summarize attachment' THEN 'summarize'
           WHEN 'Guardrail check' THEN 'guardrail'
           WHEN 'Categorize conversation' THEN 'categorize'
           WHEN 'Plan retrieval queries' THEN 'rag_planning'
           ELSE 'planner'
         END) AS thought_type,
       CASE WHEN ap.action_id IS NOT NULL THEN 'decide'
            WHEN fs.id IS NOT NULL THEN 'reason'
            ELSE 'prepare' END AS stage,
       CASE
         WHEN ap.action_id IS NOT NULL THEN COALESCE(json_extract(ap.action_payload, '$.status'), 'cancelled')
         WHEN fs.id IS NOT NULL THEN
           CASE COALESCE(json_extract(fs.payload_json, '$.status'), 'cancelled')
             WHEN 'completed' THEN 'cancelled'
             ELSE COALESCE(json_extract(fs.payload_json, '$.status'), 'cancelled') END
         ELSE
           CASE COALESCE(json_extract(p.payload_json, '$.status'), 'cancelled')
             WHEN 'completed' THEN 'cancelled'
             ELSE COALESCE(json_extract(p.payload_json, '$.status'), 'cancelled') END
       END AS status,
       COALESCE(
         NULLIF(json_extract(fs.payload_json, '$.llmRequest'), ''),
         NULLIF(json_extract(p.payload_json, '$.requestText'), ''),
         '') AS llm_request
FROM tm_prepare p
LEFT JOIN tm_stream_ranked fs ON fs.prepare_id = p.id AND fs.rank0 = 0
LEFT JOIN tm_action_pair ap ON ap.stream_id = fs.id;

-- Rows that disappear: first streams (merged into their prepare) and every
-- stream-paired action (merged into its survivor or fork row). Orphan actions
-- (no paired stream) transform in place instead.
CREATE TEMP TABLE tm_deleted AS
SELECT stream_id AS id FROM tm_survivor WHERE stream_id IS NOT NULL
UNION
SELECT action_id AS id FROM tm_action_pair WHERE stream_id IS NOT NULL;

-- 1. Merge each triplet into its prepare row. Patch order prepare <- stream
--    <- action <- computed keeps the deepest writer authoritative; RFC-7386
--    null values (decision/thoughtMs placeholders) drop their keys, which the
--    optional schema fields absorb.
UPDATE chat_entries SET
  type = 'thought',
  payload_json = (
    SELECT json_remove(
             json_patch(
               json_patch(
                 json_patch(chat_entries.payload_json, COALESCE(sv.stream_payload, '{}')),
                 COALESCE(sv.action_payload, '{}')),
               json_object(
                 'thoughtType', sv.thought_type,
                 'stage', sv.stage,
                 'status', sv.status,
                 'llmRequest', sv.llm_request)),
             '$.thoughtId', '$.requestText')
    FROM tm_survivor sv WHERE sv.prepare_id = chat_entries.id
  )
WHERE id IN (SELECT prepare_id FROM tm_survivor);

-- 2. Later streams of a group (reason forks) and orphan streams transform in
--    place into their own thought rows, absorbing their paired action.
CREATE TEMP TABLE tm_fork AS
SELECT r.id AS stream_id, r.prepare_id, r.rank0,
       ap.action_id, ap.action_payload,
       CASE WHEN ap.action_id IS NOT NULL THEN 'decide' ELSE 'reason' END AS stage,
       CASE
         WHEN ap.action_id IS NOT NULL THEN COALESCE(json_extract(ap.action_payload, '$.status'), 'cancelled')
         ELSE
           CASE COALESCE(json_extract(r.payload_json, '$.status'), 'cancelled')
             WHEN 'completed' THEN 'cancelled'
             ELSE COALESCE(json_extract(r.payload_json, '$.status'), 'cancelled') END
       END AS status
FROM tm_stream_ranked r
LEFT JOIN tm_action_pair ap ON ap.stream_id = r.id
WHERE r.rank0 > 0 OR r.prepare_id IS NULL;

UPDATE chat_entries SET
  type = 'thought',
  payload_json = (
    SELECT json_remove(
             json_patch(
               json_patch(chat_entries.payload_json, COALESCE(f.action_payload, '{}')),
               json_object('stage', f.stage, 'status', f.status)),
             '$.thoughtId')
    FROM tm_fork f WHERE f.stream_id = chat_entries.id
  )
WHERE id IN (SELECT stream_id FROM tm_fork);

-- Fork rows with a known prepare: stamp fork metadata and carry the prepare's
-- title/inputJson so the fork is labelled and itself reprocessable.
UPDATE chat_entries SET
  payload_json = (
    SELECT json_set(chat_entries.payload_json,
                    '$.forkOf', f.prepare_id,
                    '$.forkPoint', 'reason')
    FROM tm_fork f WHERE f.stream_id = chat_entries.id
  )
WHERE id IN (SELECT stream_id FROM tm_fork WHERE prepare_id IS NOT NULL);

UPDATE chat_entries SET
  payload_json = json_set(chat_entries.payload_json, '$.title', (
    SELECT json_extract(p.payload_json, '$.title')
    FROM tm_fork f JOIN tm_prepare p ON p.id = f.prepare_id
    WHERE f.stream_id = chat_entries.id
  ))
WHERE id IN (
  SELECT f.stream_id FROM tm_fork f JOIN tm_prepare p ON p.id = f.prepare_id
  WHERE json_extract(p.payload_json, '$.title') IS NOT NULL
);

UPDATE chat_entries SET
  payload_json = json_set(chat_entries.payload_json, '$.inputJson', (
    SELECT json_extract(p.payload_json, '$.inputJson')
    FROM tm_fork f JOIN tm_prepare p ON p.id = f.prepare_id
    WHERE f.stream_id = chat_entries.id
  ))
WHERE id IN (
  SELECT f.stream_id FROM tm_fork f JOIN tm_prepare p ON p.id = f.prepare_id
  WHERE json_extract(p.payload_json, '$.inputJson') IS NOT NULL
);

-- Fork rows become SIBLINGS of their survivor: parent = the prepare's
-- original parent (the global splice below fixes it up if that parent is
-- itself a deleted row).
UPDATE chat_entries SET
  parent_id = (
    SELECT op.parent_id
    FROM tm_fork f JOIN tm_orig_parent op ON op.id = f.prepare_id
    WHERE f.stream_id = chat_entries.id
  )
WHERE id IN (SELECT stream_id FROM tm_fork WHERE prepare_id IS NOT NULL);

-- 3. Orphan actions (no paired stream — degenerate/fixture data): convert in
--    place, best effort.
UPDATE chat_entries SET
  type = 'thought',
  payload_json = json_remove(
    json_patch(payload_json, json_object(
      'thoughtType', 'planner',
      'stage', 'decide',
      'status', CASE COALESCE(json_extract(payload_json, '$.status'), 'cancelled')
                  WHEN 'running' THEN 'cancelled'
                  ELSE COALESCE(json_extract(payload_json, '$.status'), 'cancelled') END)),
    '$.thoughtId')
WHERE id IN (SELECT action_id FROM tm_action_pair WHERE stream_id IS NULL);

-- 4. Splice deleted rows out of the parent chain: remap any reference to a
--    deleted row to its nearest surviving ancestor.
CREATE TEMP TABLE tm_remap AS
WITH RECURSIVE walk(did, cur) AS (
  SELECT d.id, (SELECT parent_id FROM tm_orig_parent o WHERE o.id = d.id) FROM tm_deleted d
  UNION ALL
  SELECT w.did, (SELECT parent_id FROM tm_orig_parent o WHERE o.id = w.cur)
  FROM walk w WHERE w.cur IN (SELECT id FROM tm_deleted)
)
SELECT did, cur AS target FROM walk
WHERE cur IS NULL OR cur NOT IN (SELECT id FROM tm_deleted);

UPDATE chat_entries SET
  parent_id = (SELECT target FROM tm_remap r WHERE r.did = chat_entries.parent_id)
WHERE parent_id IN (SELECT did FROM tm_remap);

-- 5. Remap anchors that may point at deleted rows.
UPDATE conversations SET
  default_view_leaf_entry_id = (SELECT target FROM tm_remap r WHERE r.did = default_view_leaf_entry_id)
WHERE default_view_leaf_entry_id IN (SELECT did FROM tm_remap);

UPDATE conversations SET
  forked_from_entry_id = (SELECT target FROM tm_remap r WHERE r.did = forked_from_entry_id)
WHERE forked_from_entry_id IN (SELECT did FROM tm_remap);

-- Checkpoint summaries anchor their range bounds "to the original entry ids
-- regardless of type" (summarizeRange.ts) — those can be triplet rows.
UPDATE chat_entries SET
  payload_json = json_set(payload_json, '$.summarizedRange.fromEntryId',
    (SELECT target FROM tm_remap r WHERE r.did = json_extract(payload_json, '$.summarizedRange.fromEntryId')))
WHERE type = 'checkpoint-summary'
  AND json_extract(payload_json, '$.summarizedRange.fromEntryId') IN (SELECT did FROM tm_remap)
  AND (SELECT target FROM tm_remap r WHERE r.did = json_extract(payload_json, '$.summarizedRange.fromEntryId')) IS NOT NULL;

UPDATE chat_entries SET
  payload_json = json_set(payload_json, '$.summarizedRange.toEntryId',
    (SELECT target FROM tm_remap r WHERE r.did = json_extract(payload_json, '$.summarizedRange.toEntryId')))
WHERE type = 'checkpoint-summary'
  AND json_extract(payload_json, '$.summarizedRange.toEntryId') IN (SELECT did FROM tm_remap)
  AND (SELECT target FROM tm_remap r WHERE r.did = json_extract(payload_json, '$.summarizedRange.toEntryId')) IS NOT NULL;

-- 6. Drop the merged rows.
DELETE FROM chat_entries WHERE id IN (SELECT id FROM tm_deleted);

DROP TABLE tm_remap;
DROP TABLE tm_fork;
DROP TABLE tm_deleted;
DROP TABLE tm_survivor;
DROP TABLE tm_action_pair;
DROP TABLE tm_stream_ranked;
DROP TABLE tm_action;
DROP TABLE tm_stream;
DROP TABLE tm_prepare;
DROP TABLE tm_orig_parent;
