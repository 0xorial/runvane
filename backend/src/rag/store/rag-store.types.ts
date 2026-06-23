/** Persisted descriptor for one RAG storage (one .sqlite file). */
export type StorageManifest = {
  id: string;
  name: string;
  /** EntitySource id this storage is built from, e.g. 'files'. */
  entitySource: string;
  /** Embedding model is a property of the storage: ingest + query must share a
   *  vector space, so it is fixed here rather than per-agent. */
  embeddingProviderId: string;
  embeddingModel: string;
  /** Discovered on first ingest; null until then. */
  embeddingDim: number | null;
  /** Source-specific params (e.g. { roots: string[], maxFileBytes: number }). */
  sourceParams: Record<string, unknown>;
  chunkSize: number;
  chunkOverlap: number;
  createdAt: string;
  lastIngestedAt: string | null;
};

/** One chunk to upsert (raw embedding; the store L2-normalizes before storing). */
export type ChunkInput = {
  chunkIndex: number;
  text: string;
  metadata: Record<string, unknown>;
  embedding: number[];
};

/** A scored chunk returned from a similarity query. */
export type StoredChunkHit = {
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  metadata: Record<string, unknown>;
  score: number;
};

export type StoreCounts = { chunks: number; sources: number };
