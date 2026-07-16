import { z } from 'zod';
import { AgentToolConfigSchema } from '../agents/agent.entity.js';

/**
 * Composer preview of the planner's per-turn baseline: the system message
 * every planner call carries (agent prompt + tools block + reply scaffolding),
 * priced part by part from the exact strings (plannerBaselineParts). Nothing
 * is persisted; `toolOverrides` mirrors `overrides.tools` so the preview
 * tracks the chat-tools draft.
 */
export const PlannerBaselinePreviewRequestSchema = z.object({
  agentId: z.string().min(1),
  toolOverrides: z.record(z.string(), AgentToolConfigSchema).optional(),
});
export type PlannerBaselinePreviewRequest = z.infer<typeof PlannerBaselinePreviewRequestSchema>;

export type PlannerBaselinePart = {
  /** ~tokens of `content` (chars/4, same estimator as every other preview). */
  tokens: number;
  /** The exact text the planner receives — the examine affordance. */
  content: string;
};

export type PlannerBaselinePreviewResult = {
  /** ~tokens of the full system message (parts joined as the planner sees them). */
  totalTokens: number;
  /** The agent's own system prompt ('' + 0 when the agent has none). */
  systemPrompt: PlannerBaselinePart;
  /** The fixed reply-format scaffolding every planner turn carries. */
  scaffolding: PlannerBaselinePart;
  /** The tools block, plus each tool's own line priced separately. */
  tools: PlannerBaselinePart & {
    perTool: Array<{ name: string; tokens: number; line: string }>;
  };
};
