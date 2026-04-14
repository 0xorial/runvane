CREATE TABLE IF NOT EXISTS conversation_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE conversations
  ADD COLUMN group_id TEXT REFERENCES conversation_groups(id);

CREATE INDEX IF NOT EXISTS idx_conversations_group_id_updated
  ON conversations(group_id, updated_at DESC);

INSERT OR IGNORE INTO conversation_groups (id, name, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  trim(c.group_name),
  c.updated_at,
  c.updated_at
FROM conversations c
WHERE trim(c.group_name) <> '';

UPDATE conversations
SET group_id = (
  SELECT g.id
  FROM conversation_groups g
  WHERE g.name = trim(conversations.group_name)
  LIMIT 1
)
WHERE group_id IS NULL
  AND trim(group_name) <> '';
