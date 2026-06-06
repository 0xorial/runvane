import { z } from 'zod';

export const RagSearchRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('ask'),
    allowed_roots: z.array(z.string().min(1)).default([]),
    max_results: z.number().finite().int().min(1).max(200).default(20),
    max_file_bytes: z.number().finite().int().min(256).max(2_000_000).default(200_000),
  })
  .strict();

export type RagSearchRules = z.infer<typeof RagSearchRulesSchema>;

export function parseRagSearchRules(raw: unknown): RagSearchRules {
  return RagSearchRulesSchema.parse(raw);
}
