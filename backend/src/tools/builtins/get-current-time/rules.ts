import { z } from 'zod';

export const GetCurrentTimeToolRulesSchema = z.object({}).strict();

export type GetCurrentTimeToolRules = z.infer<typeof GetCurrentTimeToolRulesSchema>;

export function parseGetCurrentTimeToolRules(raw: unknown): GetCurrentTimeToolRules {
  return GetCurrentTimeToolRulesSchema.parse(raw);
}
