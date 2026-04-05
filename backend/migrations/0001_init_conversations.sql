CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
  ON conversations(updated_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  models_json TEXT NOT NULL DEFAULT '[]',
  models_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_llm_configuration_json TEXT,
  default_model_preset_id INTEGER,
  model_provider_id TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(model_provider_id) REFERENCES llm_providers(id),
  FOREIGN KEY(default_model_preset_id) REFERENCES model_presets(id)
);

CREATE INDEX IF NOT EXISTS idx_agents_updated_at
  ON agents(updated_at DESC);

CREATE TABLE IF NOT EXISTS model_presets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parameters_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  task_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  is_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_pending_created_at
  ON tasks(is_done, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_entries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  conversation_index INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_entries_conversation_index
  ON chat_entries(conversation_id, conversation_index);

CREATE INDEX IF NOT EXISTS idx_chat_entries_conversation_created_at
  ON chat_entries(conversation_id, created_at DESC);
