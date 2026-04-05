export type ProviderSettingSpec = {
  key: string;
  label: string;
  type: "string" | "secret" | "url";
  required: boolean;
  placeholder?: string;
};

export type ProviderRow = {
  id: string;
  label: string;
  settings: Record<string, unknown>;
  settings_spec: ProviderSettingSpec[];
  models: string[];
  models_verified: boolean;
  quick_access_models?: string[];
  enabled_models?: string[];
};

export type LlmConfiguration = {
  provider_id: string;
  model_name: string;
  model_settings: Record<string, unknown>;
};

/** `/api/settings/llm_provider` canonical shape. */
export type LlmSettings = {
  providers: ProviderRow[];
  llm_configuration: LlmConfiguration;
};
