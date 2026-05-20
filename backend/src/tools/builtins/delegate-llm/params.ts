import { z } from 'zod';

export const DelegateLlmParamsSchema = z
  .object({
    provider_id: z
      .string()
      .min(1)
      .describe('The ID of the configured LLM provider to call (e.g. "openai", "openrouter", "lmstudio").'),
    model_name: z
      .string()
      .min(1)
      .describe('The model name to use with the provider (e.g. "gpt-4o", "mistral-7b").'),
    prompt: z.string().min(1).describe('The user prompt to send to the model.'),
    system_prompt: z
      .string()
      .optional()
      .describe('Optional system instruction prepended to the conversation.'),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        }),
      )
      .optional()
      .describe('Optional prior conversation context, appended before the prompt.'),
  })
  .strict();

export type DelegateLlmParams = z.infer<typeof DelegateLlmParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function delegateLlmParamsSchema(): unknown {
  return z.toJSONSchema(DelegateLlmParamsSchema);
}

export function parseDelegateLlmParams(raw: unknown): DelegateLlmParams {
  return DelegateLlmParamsSchema.parse(raw);
}
