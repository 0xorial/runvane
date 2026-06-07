import type { AgentEntity, AgentToolConfig } from '../agents/agent.entity.js';

export function resolveToolConfig(
  agent: AgentEntity | null | undefined,
  toolOverrides: Record<string, AgentToolConfig> | undefined,
  toolName: string,
): AgentToolConfig {
  const agentCfg = agent?.default_llm_configuration?.tools?.[toolName];
  const override = toolOverrides?.[toolName];
  if (!override) return agentCfg ?? {};
  const mergedRules =
    override.rules !== undefined || agentCfg?.rules !== undefined
      ? { ...(agentCfg?.rules ?? {}), ...(override.rules ?? {}) }
      : undefined;
  return {
    ...agentCfg,
    ...override,
    ...(mergedRules !== undefined ? { rules: mergedRules } : {}),
  };
}
