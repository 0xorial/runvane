import { LlmRequestSchema } from "../../../backend/src/llmProviders/types";
import { AgenticPlannerOutputSchema } from "../../../backend/src/contracts/chatEntry";

/**
 * Zod schemas wired into the chat-entry editors (ZodJsonEditor). Each is the
 * same schema the backend validates against — the editor is type-checked
 * against it and the two cannot drift.
 */

/** Prepare-step prompt editor — the LlmRequest the thought will send. */
export { LlmRequestSchema };

/** Planner reasoning/response editor — the planner's structured output. */
export { AgenticPlannerOutputSchema };
