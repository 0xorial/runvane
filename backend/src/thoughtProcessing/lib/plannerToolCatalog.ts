import type { AgentEntity, AgentToolConfig } from '../../agents/agent.entity.js';
import { resolveSeparateParamsResolution, resolveToolConfig } from '../../tools/resolve-tool-config.js';
import { withToolNoteProperty } from '../../tools/toolParamEnvelope.js';
import type { ToolRegistry } from '../../tools/tool-registry.js';
import { extractToolOperations, type PlannerToolInfo } from './plannerPrompt.js';

/**
 * The planner's effective tool catalog for one turn, shared by the planner
 * provider (real turn) and the composer's baseline preview endpoint — the
 * same one-source discipline as formatContextFilesBlock/formatRetrievalContext,
 * so the token counts the user sees are computed from the exact tool lines
 * the planner receives.
 */

export function resolveEnabledPlannerToolIds(
  registry: ToolRegistry,
  agent: AgentEntity,
  toolOverrides?: Record<string, AgentToolConfig>,
): string[] {
  return registry
    .list()
    .filter((tool) => {
      const policy = resolveToolConfig(agent, toolOverrides, tool.getName()).policy;
      return policy != null && policy !== 'off';
    })
    .map((tool) => tool.getName());
}

export function resolveDirectPlannerToolIds(
  agent: AgentEntity,
  toolOverrides: Record<string, AgentToolConfig> | undefined,
  enabledToolIds: string[],
): string[] {
  return enabledToolIds.filter((name) => !resolveSeparateParamsResolution(agent, toolOverrides, name));
}

/** Enrich bare enabled-tool names with each tool's model-facing description,
 *  dispatch operations, and (for direct-args tools) the literal schema. */
export function describePlannerToolInfos(
  registry: ToolRegistry,
  enabledToolIds: string[],
  directToolIds: string[],
): PlannerToolInfo[] {
  const direct = new Set(directToolIds);
  return enabledToolIds.map((name) => {
    const tool = registry.get(name);
    return {
      name,
      description: tool?.getAiDescription() ?? '',
      operations: tool ? extractToolOperations(tool.getParamsSchema()) : [],
      // Direct-args tools need their schema in the prompt: the model writes
      // the literal JSON args itself, no resolver fills them in.
      ...(direct.has(name) && tool ? { directParamsSchema: withToolNoteProperty(tool.getParamsSchema()) } : {}),
    };
  });
}
