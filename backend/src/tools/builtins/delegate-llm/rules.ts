import { z } from 'zod';

export const DelegateLlmRulesSchema = z
  .object({
    allowed_provider_ids: z
      .array(z.string().min(1))
      .default([])
      .describe('Allowlist of provider IDs. Empty means all configured providers are allowed.'),
    max_prompt_chars: z
      .number()
      .finite()
      .int()
      .min(1)
      .default(50000)
      .describe('Maximum number of characters allowed in the prompt before truncation.'),
    max_response_chars: z
      .number()
      .finite()
      .int()
      .min(1)
      .default(20000)
      .describe('Maximum number of characters returned from the LLM response.'),
  })
  .strict();

export type DelegateLlmRules = z.infer<typeof DelegateLlmRulesSchema>;

export function parseDelegateLlmRules(raw: unknown): DelegateLlmRules {
  return DelegateLlmRulesSchema.parse(raw);
}
