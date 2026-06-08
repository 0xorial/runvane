import type { LlmProviderRow } from "../../../backend/src/contracts/settings";

export type ProviderSettingSpec = {
  key: string;
  label: string;
  type: "string" | "secret" | "url";
  required: boolean;
  placeholder?: string;
};

export type ProviderRow = LlmProviderRow & {
  enabled_models?: string[];
};

export type LlmConfiguration = {
  provider_id: string;
  model_name: string;
  title_provider_id?: string;
  title_model_name?: string;
  model_settings: Record<string, unknown>;
};

export type LlmSettings = {
  providers: ProviderRow[];
  llm_configuration: LlmConfiguration;
};
