import { z } from 'zod';
import { StorageGraphSchema } from '../../../knowledge/contracts/knowledge.js';

/**
 * Per-agent knowledge config lives in this tool's rules — the same mechanism every
 * other tool uses for per-agent configuration. `storages` selects which knowledge
 * storages the agent retrieves from. `strategy` 'graph' walks the storages'
 * knowledge graphs (≤ `max_hops`) from the vector seeds and adds
 * connected-but-lexically-far chunks plus an entity/relation context block;
 * it needs storages ingested with a graph builder.
 */
export const KnowledgeToolRulesSchema = z
  .object({
    storages: z.array(z.string().min(1)).default([]),
    top_k: z.number().finite().int().min(1).max(50).default(8),
    strategy: z.enum(['simple', 'graph']).default('simple'),
    max_hops: z.number().finite().int().min(1).max(3).default(1),
    /** Lets the agent grow its own index from chat (`add_source`,
     *  `create_storage`). Off by default: indexing a path both reads it and
     *  persists its content into the storage, so it needs an explicit
     *  per-agent opt-in. */
    allow_source_changes: z.boolean().default(false),
    /** Template for storages the agent creates from chat (`create_storage`).
     *  Embedding/graph model choices are cost decisions and stay with the
     *  user — the model only picks a name and roots. Unset = the agent can
     *  add sources to existing storages but not create new ones. */
    storage_defaults: z
      .object({
        embeddingProviderId: z.string().min(1),
        embeddingModel: z.string().min(1),
        graph: StorageGraphSchema.nullish(),
        watch: z.boolean().default(false),
      })
      .nullish(),
  })
  .strict();

export type KnowledgeToolRules = z.infer<typeof KnowledgeToolRulesSchema>;

export function parseKnowledgeToolRules(raw: unknown): KnowledgeToolRules {
  return KnowledgeToolRulesSchema.parse(raw);
}
