import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  PlannerBaselinePreviewRequestSchema,
  type PlannerBaselinePreviewResult,
} from '../contracts/planner-baseline.js';
import { DEFAULT_PLANNER_REPLY_FORMAT } from '../agents/agent.entity.js';
import { AgentsRepo } from '../db/repositories/agents.repo.js';
import { estimateContextTokens } from '../knowledge/retrieval/retrieval-context.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { plannerBaselineParts, plannerSystemContent } from './lib/plannerPrompt.js';
import {
  describePlannerToolInfos,
  resolveDirectPlannerToolIds,
  resolveEnabledPlannerToolIds,
} from './lib/plannerToolCatalog.js';

class PlannerBaselinePreviewDto extends createZodDto(PlannerBaselinePreviewRequestSchema) {}

/**
 * Composer preview of the planner's per-turn baseline (system prompt + tools
 * block + reply scaffolding), priced from the exact strings the planner
 * receives — the same shared-source discipline as the context/knowledge
 * previews. Persists nothing.
 */
@Controller('api/planner-baseline')
export class PlannerBaselineController {
  constructor(
    private readonly agents: AgentsRepo,
    private readonly tools: ToolRegistry,
  ) {}

  @Post('preview')
  async preview(@Body() body: PlannerBaselinePreviewDto): Promise<PlannerBaselinePreviewResult> {
    const agent = await this.agents.get(body.agentId);
    if (!agent) throw new NotFoundException(`agent ${body.agentId} not found`);

    const enabled = resolveEnabledPlannerToolIds(this.tools, agent, body.toolOverrides);
    const direct = resolveDirectPlannerToolIds(agent, body.toolOverrides, enabled);
    const infos = describePlannerToolInfos(this.tools, enabled, direct);

    const systemPrompt = agent.system_prompt ?? '';
    const replyFormat = agent.default_llm_configuration?.planner_reply_format ?? DEFAULT_PLANNER_REPLY_FORMAT;
    const parts = plannerBaselineParts(systemPrompt, infos, replyFormat);
    return {
      replyFormat,
      totalTokens: estimateContextTokens(plannerSystemContent(systemPrompt, infos, replyFormat)),
      systemPrompt: {
        tokens: parts.systemPrompt.length > 0 ? estimateContextTokens(parts.systemPrompt) : 0,
        content: parts.systemPrompt,
      },
      scaffolding: { tokens: estimateContextTokens(parts.scaffolding), content: parts.scaffolding },
      tools: {
        tokens: estimateContextTokens(parts.toolsBlock),
        content: parts.toolsBlock,
        perTool: parts.toolLines.map((t) => ({
          name: t.name,
          tokens: estimateContextTokens(t.line),
          line: t.line,
        })),
      },
    };
  }
}
