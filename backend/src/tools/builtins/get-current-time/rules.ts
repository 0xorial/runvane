import { z } from 'zod';

export const GetCurrentTimeToolRulesSchema = z
  .object({
    allowed: z
      .enum(['always', 'never', 'ask'])
      .default('always')
      .describe('Single permission rule for this tool.'),
  })
  .strict();

export type GetCurrentTimeToolRules = z.infer<typeof GetCurrentTimeToolRulesSchema>;

export function parseGetCurrentTimeToolRules(raw: unknown): GetCurrentTimeToolRules {
  return GetCurrentTimeToolRulesSchema.parse(raw);
}
