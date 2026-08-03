INSERT INTO llm_providers (
  id,
  label,
  settings_json,
  models_json,
  models_pricing_json,
  models_verified,
  created_at,
  updated_at
)
VALUES (
  'stub',
  'Test stub',
  '{"base_url":""}',
  '["stub-model"]',
  '{"stub-model":{"inCostPer1m":2,"cachedInCostPer1m":1,"outCostPer1m":10}}',
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

-- Auto-categorization is OFF by default for tests so it can't perturb specs
-- that don't opt in; the categorization spec enables it via the settings API.
INSERT INTO settings (key, value_json, updated_at)
VALUES (
  'conversation_categorization',
  '{"enabled":false,"sidebarRecentLimit":200,"prompt":"Classify the conversation into a single short category."}',
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
  '{"provider_id":"stub","model_name":"stub","tools":{"get_current_time":{"policy":"allow"},"ask_attachment":{"policy":"allow"},"todo_write":{"policy":"allow"},"switch_llm":{"policy":"allow"},"run_subagent":{"policy":"allow"}}}',
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
  'Guarded assistant',
  '',
  '{"provider_id":"stub","model_name":"stub","guardrail":{"provider_id":"stub","model_name":"stub"},"tools":{"get_current_time":{"policy":"ask","guardrail":true}}}',
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
  'Restricted assistant',
  '',
  '{"provider_id":"stub","model_name":"stub","tools":{"get_current_time":{"policy":"off"}}}',
  NULL,
  'stub',
  'stub',
  0,
  NULL,
  NULL,
  datetime('now'),
  datetime('now')
);
