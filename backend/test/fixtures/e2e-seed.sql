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
  '{"provider_id":"stub","model_name":"stub","tools":{"get_current_time":{"enabled":true}}}',
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
