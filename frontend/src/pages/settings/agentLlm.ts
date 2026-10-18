import type { PlannerReplyFormat } from "../../../../backend/src/agents/agent.entity";
import type { AgentListItemResponse } from "../../../../backend/src/contracts/agents";

export type AgentLlmRow = { provider_id: string; model: string };

export function getAgentLlm(agent: AgentListItemResponse | null | undefined): AgentLlmRow {
  const cfg = agent?.default_llm_configuration;
  const modelRef = agent?.model_reference;
  if (!cfg && !modelRef) return { provider_id: "", model: "" };
  return {
    provider_id: String(cfg?.provider_id ?? modelRef?.provider_id ?? ""),
    model: String(cfg?.model_name ?? modelRef?.model_name ?? ""),
  };
}

export function getPlannerReplyFormat(agent: AgentListItemResponse | null | undefined): PlannerReplyFormat {
  return agent?.default_llm_configuration?.planner_reply_format === "native" ? "native" : "json";
}

export function patchPlannerReplyFormat(agent: AgentListItemResponse, value: string): AgentListItemResponse {
  const planner_reply_format: PlannerReplyFormat = value === "native" ? "native" : "json";
  return {
    ...agent,
    default_llm_configuration: { ...(agent.default_llm_configuration ?? {}), planner_reply_format },
  };
}

export function patchAgentLlm(agent: AgentListItemResponse, patch: Partial<AgentLlmRow>): AgentListItemResponse {
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
