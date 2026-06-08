import { z } from 'zod';

export const ApiToolRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('ask'),
  })
  .strict();

export type ApiToolRules = z.infer<typeof ApiToolRulesSchema>;

export function parseApiToolRules(raw: unknown): ApiToolRules {
  return ApiToolRulesSchema.parse(raw);
}
