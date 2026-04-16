ALTER TABLE conversations ADD COLUMN last_message_at TEXT;

UPDATE conversations
SET last_message_at = COALESCE(
  (
    SELECT MAX(e.created_at)
    FROM chat_entries e
    WHERE e.conversation_id = conversations.id
      AND e.type IN ('user-message', 'assistant-message')
  ),
  conversations.created_at
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at
  ON conversations(last_message_at DESC);

DROP TRIGGER IF EXISTS trg_conversations_touch_last_message_at;

CREATE TRIGGER trg_conversations_touch_last_message_at
AFTER INSERT ON chat_entries
WHEN NEW.type IN ('user-message', 'assistant-message')
BEGIN
  UPDATE conversations
  SET last_message_at = CASE
    WHEN last_message_at IS NULL OR NEW.created_at > last_message_at THEN NEW.created_at
    ELSE last_message_at
  END
  WHERE id = NEW.conversation_id;
END;
