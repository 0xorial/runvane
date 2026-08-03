import { z } from 'zod';

export const SwitchLlmRulesSchema = z
  .object({
    allowed_models: z
      .array(z.string().min(1))
      .default([])
      .describe(
        'Allowlist of "provider_id/model_name" entries the agent may switch to. ' +
          'Empty means any model on any configured provider.',
      ),
  })
  .strict();

export type SwitchLlmRules = z.infer<typeof SwitchLlmRulesSchema>;

export function parseSwitchLlmRules(raw: unknown): SwitchLlmRules {
  return SwitchLlmRulesSchema.parse(raw);
}
