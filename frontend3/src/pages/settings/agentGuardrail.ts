export type GuardrailConfig = {
  provider_id: string;
  model_name: string;
  system_prompt: string;
};

export function readGuardrailConfig(llmCfg: Record<string, unknown> | null | undefined): GuardrailConfig {
  const g = llmCfg?.guardrail;
  if (!g || typeof g !== "object" || Array.isArray(g)) {
    return { provider_id: "", model_name: "", system_prompt: "" };
  }
  const rec = g as Record<string, unknown>;
  return {
    provider_id: typeof rec.provider_id === "string" ? rec.provider_id : "",
    model_name: typeof rec.model_name === "string" ? rec.model_name : "",
    system_prompt: typeof rec.system_prompt === "string" ? rec.system_prompt : "",
  };
}
