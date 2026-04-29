import type { AgentDefaultLlmConfiguration, AgentEntity } from './agent.entity.js';

export type AgentRouteResponse = AgentEntity & {
  llms: Array<Record<string, unknown>>;
};

export function llmsFromAgent(
  cfg: AgentDefaultLlmConfiguration | null,
  modelRef: { provider_id: string; model_name: string } | null,
): Array<Record<string, unknown>> {
  const provider_id = String(cfg?.provider_id ?? modelRef?.provider_id ?? '');
  const model = String(cfg?.model_name ?? modelRef?.model_name ?? '');
  if (!provider_id && !model) return [];
  return [{ role: 'chat', provider_id, model }];
}

export function toAgentResponse(row: AgentEntity): AgentRouteResponse {
  return {
    ...row,
    llms: llmsFromAgent(row.default_llm_configuration, row.model_reference),
  };
}
