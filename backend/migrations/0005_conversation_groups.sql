ALTER TABLE conversations
  ADD COLUMN group_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_conversations_group_updated
  ON conversations(group_name, updated_at DESC);
