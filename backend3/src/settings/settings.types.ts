import type { LlmProviderSettingSpec } from '../llmProviders/provider.js';

export type LlmProviderRow = {
  id: string;
  label: string;
  settings: Record<string, unknown>;
  settings_spec: LlmProviderSettingSpec[];
  models: string[];
  models_verified: boolean;
};

export type LlmConfiguration = {
  provider_id: string;
  model_name: string;
  tool_call_provider_id?: string;
  tool_call_model_name?: string;
  model_settings: Record<string, unknown>;
};

export type LlmProviderSettingsDocument = {
  providers: LlmProviderRow[];
  llm_configuration: LlmConfiguration;
};

export type LlmProviderConnectionTestResponse = {
  ok: boolean;
  detail: string | null;
  models: string[];
};
