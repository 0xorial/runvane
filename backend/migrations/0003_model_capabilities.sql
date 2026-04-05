CREATE TABLE IF NOT EXISTS model_capabilities (
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  supports_image_input INTEGER NOT NULL DEFAULT 0,
  supports_file_input INTEGER NOT NULL DEFAULT 0,
  max_context_tokens INTEGER,
  max_output_tokens INTEGER,
  input_cost_per_1m REAL,
  output_cost_per_1m REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, model_name)
);

CREATE TABLE IF NOT EXISTS model_capability_overrides (
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  supports_image_input INTEGER,
  supports_file_input INTEGER,
  max_context_tokens INTEGER,
  max_output_tokens INTEGER,
  input_cost_per_1m REAL,
  output_cost_per_1m REAL,
  currency TEXT,
  notes TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, model_name)
);

CREATE INDEX IF NOT EXISTS idx_model_capabilities_provider
  ON model_capabilities(provider_id, model_name);

