ALTER TABLE conversations
  ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversations_deleted_updated
  ON conversations(is_deleted, updated_at DESC);
