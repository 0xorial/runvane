import { z } from 'zod';

export const MetaToolRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('always'),
  })
  .strict();

export type MetaToolRules = z.infer<typeof MetaToolRulesSchema>;

export function parseMetaToolRules(raw: unknown): MetaToolRules {
  return MetaToolRulesSchema.parse(raw);
}
