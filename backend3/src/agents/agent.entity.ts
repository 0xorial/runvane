export type AgentDefaultLlmConfiguration = {
  provider_id: string;
  model_name: string;
  tool_call_provider_id?: string;
  tool_call_model_name?: string;
  model_settings?: Record<string, unknown>;
};

export type AgentEntity = {
  id: string;
  name: string;
  system_prompt: string;
  default_llm_configuration: AgentDefaultLlmConfiguration | null;
  default_model_preset_id: number | null;
  model_reference: { provider_id: string; model_name: string } | null;
  created_at: string;
  updated_at: string;
};
