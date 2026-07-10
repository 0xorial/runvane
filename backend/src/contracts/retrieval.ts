import { z } from 'zod';

/**
 * Forced-retrieval contracts (docs/rag-revamp-plan.md): the harness-driven
 * retrieval pipeline a user opts into per message via `overrides.rag` —
 * distinct from the model-driven `rag` tool. One query schema, two producers:
 * verbatim mode fills it from the user message; the rag-planning thought's
 * structured output IS this shape (phase 2b). The retrieval executor and the
 * entry rendering never know which mode produced the queries.
 */
export const RetrievalQuerySchema = z.object({
  text: z.string().min(1),
  /** Storage ids this query runs against; omitted = the override's full set. */
  storages: z.array(z.string().min(1)).optional(),
  origin: z.enum(['verbatim', 'planned']),
});
export type RetrievalQuery = z.infer<typeof RetrievalQuerySchema>;

export const RetrievalHitSchema = z.object({
  /** Storage display name. */
  storage: z.string(),
  /** Source label (relative path for file sources, else the source id). */
  source: z.string(),
  chunkIndex: z.number().int(),
  score: z.number(),
  /** How the chunk was found: vector similarity, or knowledge-graph expansion. */
  origin: z.enum(['seed', 'graph']),
  text: z.string(),
});
export type RetrievalHit = z.infer<typeof RetrievalHitSchema>;

/** Per-message forced-retrieval request (`overrides.rag`). Presence of the
 *  key IS the force signal: retrieval always executes — planning (phase 2b)
 *  only shapes *how*, never *whether*. */
export const RagOverrideSchema = z.object({
  storages: z.array(z.string().min(1)).min(1),
  top_k: z.number().finite().int().min(1).max(50).optional(),
  /** 'verbatim' (default): the message text is the embedding query.
   *  'preplanned': a rag-planning thought composes the queries first. */
  mode: z.enum(['verbatim', 'preplanned']).optional(),
});
export type RagOverride = z.infer<typeof RagOverrideSchema>;
