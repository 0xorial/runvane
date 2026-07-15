import { z } from 'zod';

/**
 * One dispatch surface, three operations (runvane's one-tool-per-capability
 * pattern): retrieval plus the source-management ops that let the agent grow
 * its own index from chat. `suggest_sources` returns scan results for the
 * model to judge; `add_source` is additionally gated by the
 * `allow_source_changes` rule.
 */
export const KnowledgeToolParamsSchema = z
  .object({
    operation: z
      .enum(['query', 'list_storages', 'read_source', 'suggest_sources', 'add_source', 'create_storage'])
      .default('query')
      .describe(
        'query: semantic retrieval (default). list_storages: orient — the storages this agent can ' +
          'search, with counts and roots (pass `storage` to also list its indexed sources). ' +
          'read_source: full text of one indexed source (by the `source` label a query hit or ' +
          'list_storages returned). suggest_sources: explore a base directory and list ' +
          'indexable candidate folders. add_source: add root folders to a configured storage and re-index. ' +
          'create_storage: create a new storage from the agent-configured defaults (name + optional roots) ' +
          'when no suitable storage exists.',
      ),
    name: z
      .string()
      .min(1)
      .optional()
      .describe('create_storage: short human name for the new storage.'),
    query: z
      .string()
      .min(1)
      .optional()
      .describe('query: natural-language query; retrieves the most semantically similar indexed chunks.'),
    top_k: z
      .number()
      .finite()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('query: max chunks to return (capped by the agent rule).'),
    base: z
      .string()
      .min(1)
      .optional()
      .describe('suggest_sources: absolute directory to explore.'),
    storage: z
      .string()
      .min(1)
      .optional()
      .describe(
        'add_source/read_source: target storage name or id; defaults to the only configured storage. ' +
          "list_storages: when set, the response also lists that storage's indexed sources.",
      ),
    source: z
      .string()
      .min(1)
      .optional()
      .describe('read_source: the source to read — the `source` label from a query hit or list_storages.'),
    roots: z
      .array(z.string().min(1))
      .optional()
      .describe('add_source: absolute directory paths to add as indexing roots.'),
  })
  .strict();

export type KnowledgeToolParams = z.infer<typeof KnowledgeToolParamsSchema>;

export function knowledgeToolParamsSchema(): unknown {
  return z.toJSONSchema(KnowledgeToolParamsSchema);
}

export function parseKnowledgeToolParams(raw: unknown): KnowledgeToolParams {
  return KnowledgeToolParamsSchema.parse(raw);
}
