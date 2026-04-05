import type { AgentListItemResponse } from "../../../../backend/src/routes/agents.types";

export type AgentLlmRow = { provider_id: string; model: string };

export function getAgentLlm(
  agent: AgentListItemResponse | null | undefined,
): AgentLlmRow {
  const cfg = agent?.default_llm_configuration;
  const modelRef = agent?.model_reference;
  if (!cfg && !modelRef) return { provider_id: "", model: "" };
  return {
    provider_id: String(cfg?.provider_id ?? modelRef?.provider_id ?? ""),
    model: String(cfg?.model_name ?? modelRef?.model_name ?? ""),
  };
}

export function patchAgentLlm(
  agent: AgentListItemResponse,
  patch: Partial<AgentLlmRow>,
): AgentListItemResponse {
  const cur = getAgentLlm(agent);
  return {
    ...agent,
    default_llm_configuration: {
      ...(agent.default_llm_configuration ?? {}),
      provider_id: patch.provider_id ?? cur.provider_id,
      model_name: patch.model ?? cur.model,
    },
    model_reference: null,
  };
}
