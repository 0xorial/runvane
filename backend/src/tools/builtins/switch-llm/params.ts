import { z } from 'zod';

export const SwitchLlmParamsSchema = z
  .object({
    provider_id: z
      .string()
      .min(1)
      .describe('The configured LLM provider to switch to (e.g. "openrouter", "lmstudio").'),
    model_name: z.string().min(1).describe('The model to run the upcoming planning rounds on.'),
    scope: z
      .enum(['this_run', 'n_turns'])
      .default('this_run')
      .describe(
        'When the switch reverts: "this_run" (default) reverts when the current run ends (at the next ' +
          'user message); "n_turns" reverts after `turns` planning rounds.',
      ),
    turns: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Required with scope "n_turns": how many planning rounds run on the switched model.'),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.scope === 'n_turns' && val.turns === undefined) {
      ctx.addIssue({ code: 'custom', message: 'turns is required when scope is "n_turns"', path: ['turns'] });
    }
  });

export type SwitchLlmParams = z.infer<typeof SwitchLlmParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function switchLlmParamsSchema(): unknown {
  return z.toJSONSchema(SwitchLlmParamsSchema);
}

export function parseSwitchLlmParams(raw: unknown): SwitchLlmParams {
  return SwitchLlmParamsSchema.parse(raw);
}
