ALTER TABLE chat_entries ADD COLUMN parent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_entries_parent_id
  ON chat_entries(parent_id);

ALTER TABLE tasks ADD COLUMN source_entry_id TEXT;

ALTER TABLE conversations ADD COLUMN active_leaf_entry_id TEXT;

UPDATE conversations
SET active_leaf_entry_id = (
  SELECT e.id
  FROM chat_entries e
  WHERE e.conversation_id = conversations.id
  ORDER BY e.conversation_index DESC
  LIMIT 1
);
