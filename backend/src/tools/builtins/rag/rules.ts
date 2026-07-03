import { z } from 'zod';

/**
 * Per-agent RAG config lives in this tool's rules — the same mechanism every
 * other tool uses for per-agent configuration. `storages` selects which RAG
 * storages the agent retrieves from. `strategy` 'graph' walks the storages'
 * knowledge graphs (≤ `max_hops`) from the vector seeds and adds
 * connected-but-lexically-far chunks plus an entity/relation context block;
 * it needs storages ingested with a graph builder ('fanout' query-expansion
 * lands in a later phase).
 */
export const RagToolRulesSchema = z
  .object({
    storages: z.array(z.string().min(1)).default([]),
    top_k: z.number().finite().int().min(1).max(50).default(8),
    strategy: z.enum(['simple', 'graph']).default('simple'),
    max_hops: z.number().finite().int().min(1).max(3).default(1),
  })
  .strict();

export type RagToolRules = z.infer<typeof RagToolRulesSchema>;

export function parseRagToolRules(raw: unknown): RagToolRules {
  return RagToolRulesSchema.parse(raw);
}
