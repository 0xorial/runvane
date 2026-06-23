import { z } from 'zod';

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
  })
  .strict();
export type CreateStorageBody = z.infer<typeof CreateStorageSchema>;

/** Body for a debug similarity query against one or more storages. */
export const RagDebugQuerySchema = z
  .object({
    query: z.string().min(1),
    storageIds: z.array(z.string().min(1)).optional(),
    topK: z.number().finite().int().min(1).max(50).default(8),
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
  createdAt: string;
  lastIngestedAt: string | null;
  counts: { chunks: number; sources: number };
};
