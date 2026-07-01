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

/**
 * Whether calling `toolName` should go through the separate "resolve tool
 * parameters" LLM step. The agent-level `separate_params_resolution` flag —
 * when set to `true` or `false` — overrides every tool's own flag; only when
 * it is `null`/absent does the per-tool (agent config × conversation
 * override) flag apply, defaulting to `true` (today's always-resolve
 * behavior) when that too is unset.
 */
export function resolveSeparateParamsResolution(
  agent: AgentEntity | null | undefined,
  toolOverrides: Record<string, AgentToolConfig> | undefined,
  toolName: string,
): boolean {
  const agentOverride = agent?.default_llm_configuration?.separate_params_resolution;
  if (agentOverride != null) return agentOverride;
  return resolveToolConfig(agent, toolOverrides, toolName).separate_params_resolution ?? true;
}
