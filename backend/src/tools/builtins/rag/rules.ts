import { z } from 'zod';

/**
 * Per-agent RAG config lives in this tool's rules — the same mechanism every
 * other tool uses for per-agent configuration. `storages` selects which RAG
 * storages the agent retrieves from; `strategy` is 'simple' for now ('fanout'
 * query-expansion lands in a later phase).
 */
export const RagToolRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('ask'),
    storages: z.array(z.string().min(1)).default([]),
    top_k: z.number().finite().int().min(1).max(50).default(8),
    strategy: z.enum(['simple']).default('simple'),
  })
  .strict();

export type RagToolRules = z.infer<typeof RagToolRulesSchema>;

export function parseRagToolRules(raw: unknown): RagToolRules {
  return RagToolRulesSchema.parse(raw);
}
