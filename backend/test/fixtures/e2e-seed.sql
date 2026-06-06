INSERT INTO agents (
  id,
  name,
  system_prompt,
  default_llm_configuration_json,
  default_model_preset_id,
  model_provider_id,
  model_name,
  is_default,
  icon,
  color,
  created_at,
  updated_at
)
VALUES (
  'e2e00000-0000-4000-8000-000000000001',
  'agent 1',
  '',
  NULL,
  NULL,
  'stub',
  'stub',
  1,
  NULL,
  NULL,
  datetime('now'),
  datetime('now')
);
