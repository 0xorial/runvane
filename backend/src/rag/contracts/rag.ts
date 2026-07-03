import { z } from 'zod';

/** Knowledge-graph config for a storage: which builder extracts it, with builder-specific params. */
export const StorageGraphSchema = z
  .object({
    builder: z.string().min(1),
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type StorageGraphConfig = z.infer<typeof StorageGraphSchema>;

/** Body for creating a storage. `sourceParams` is source-specific (e.g. files → { roots }). */
export const CreateStorageSchema = z
  .object({
    name: z.string().min(1),
    entitySource: z.string().min(1),
    embeddingProviderId: z.string().min(1),
    embeddingModel: z.string().min(1),
    sourceParams: z.record(z.string(), z.unknown()).default({}),
    chunkSize: z.number().finite().int().min(1).max(100_000).optional(),
    chunkOverlap: z.number().finite().int().min(0).max(100_000).optional(),
    graph: StorageGraphSchema.nullish(),
  })
  .strict();
export type CreateStorageBody = z.infer<typeof CreateStorageSchema>;

/** Body for a debug similarity query against one or more storages. */
export const RagDebugQuerySchema = z
  .object({
    query: z.string().min(1),
    storageIds: z.array(z.string().min(1)).optional(),
    topK: z.number().finite().int().min(1).max(50).default(8),
    strategy: z.enum(['simple', 'graph']).default('simple'),
    maxHops: z.number().finite().int().min(1).max(3).default(1),
  })
  .strict();
export type RagDebugQueryBody = z.infer<typeof RagDebugQuerySchema>;

export type IngestResult = {
  storageId: string;
  added: number;
  updated: number;
  skipped: number;
  removed: number;
  totalChunks: number;
  totalSources: number;
  embeddingDim: number | null;
  /** Present iff the storage has a graph layer configured. `failedSources`
   *  counts items whose extraction failed this run (retried on next ingest). */
  graph: { nodes: number; edges: number; failedSources: number } | null;
};

export type RagQueryHit = {
  storageId: string;
  storageName: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
  /** How this chunk was found: direct vector similarity, or pulled in by
   *  graph expansion from a seed chunk's entities. */
  origin: 'seed' | 'graph';
};

/** The knowledge-graph neighborhood surfaced alongside graph-strategy hits. */
export type RagGraphContext = {
  entities: Array<{ name: string; type: string; description: string }>;
  relations: Array<{ source: string; relation: string; target: string; description: string }>;
};

export type RagRetrieveResult = {
  hits: RagQueryHit[];
  /** Null for the 'simple' strategy or when no graph data matched. */
  graph: RagGraphContext | null;
};

export type RagStorageInfo = {
  id: string;
  name: string;
  entitySource: string;
  embeddingProviderId: string;
  embeddingModel: string;
  embeddingDim: number | null;
  sourceParams: Record<string, unknown>;
  chunkSize: number;
  chunkOverlap: number;
  graph: StorageGraphConfig | null;
  createdAt: string;
  lastIngestedAt: string | null;
  counts: { chunks: number; sources: number; nodes: number; edges: number };
};
