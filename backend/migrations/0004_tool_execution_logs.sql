CREATE TABLE IF NOT EXISTS tool_execution_logs (
  id INTEGER PRIMARY KEY,
  task_id INTEGER,
  conversation_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  phase TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_execution_logs_conversation_created_at
  ON tool_execution_logs(conversation_id, created_at DESC);

