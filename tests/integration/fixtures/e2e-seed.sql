INSERT INTO llm_providers (
  id,
  label,
  settings_json,
  models_json,
  models_verified,
  created_at,
  updated_at
)
VALUES (
  'stub',
  'Test stub',
  '{"base_url":""}',
  '["stub-model"]',
  1,
  datetime('now'),
  datetime('now')
);

INSERT INTO settings (key, value_json, updated_at)
VALUES (
  'llm_configuration',
  '{"provider_id":"stub","model_name":"stub","model_settings":{}}',
  datetime('now')
);

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
  '{"provider_id":"stub","model_name":"stub","tools":{"get_current_time":{"enabled":true},"ask_attachment":{"enabled":true,"rules":{"allowed":"always"}}}}',
  NULL,
  'stub',
  'stub',
  1,
  NULL,
  NULL,
  datetime('now'),
  datetime('now')
);

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
  'e2e00000-0000-4000-8000-000000000002',
  'e2e guarded',
  '',
  '{"provider_id":"stub","model_name":"stub","guardrail":{"provider_id":"stub","model_name":"stub"},"tools":{"get_current_time":{"enabled":true,"rules":{"allowed":"ask"},"guardrail":true}}}',
  NULL,
  'stub',
  'stub',
  0,
  NULL,
  NULL,
  datetime('now'),
  datetime('now')
);

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
  'e2e00000-0000-4000-8000-000000000003',
  'e2e forbid tool',
  '',
  '{"provider_id":"stub","model_name":"stub","tools":{"get_current_time":{"enabled":true,"rules":{"allowed":"never"}}}}',
  NULL,
  'stub',
  'stub',
  0,
  NULL,
  NULL,
  datetime('now'),
  datetime('now')
);
