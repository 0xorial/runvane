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
  /** Knowledge-graph extraction config; like the embedding model it is fixed
   *  at creation (the graph must be built consistently across ingests).
   *  Null = no graph layer for this storage. */
  graph?: { builder: string; params: Record<string, unknown> } | null;
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

export type StoreCounts = { chunks: number; sources: number; nodes: number; edges: number };

/**
 * Normalized per-source graph extraction — the contract every GraphBuilder
 * maps its library/model output into. Node references in `edges`/`mentions`
 * are by (display) name; the store resolves them to node rows, deduplicating
 * case-insensitively.
 */
export type SourceGraphInput = {
  nodes: Array<{ name: string; type?: string; description?: string }>;
  edges: Array<{ source: string; target: string; relation: string; description?: string }>;
  /** Chunk provenance: which chunk indexes mention a node. Optional per node —
   *  builders without chunk-level provenance can omit entries; retrieval then
   *  degrades to relation context only for those nodes. */
  mentions: Array<{ node: string; chunkIndex: number }>;
};

export type StoredGraphNode = { id: number; name: string; type: string; description: string };

export type StoredGraphEdge = {
  sourceNodeId: number;
  targetNodeId: number;
  sourceName: string;
  targetName: string;
  relation: string;
  description: string;
};

/** Address of one stored chunk (for mention provenance lookups). */
export type ChunkRef = { sourceType: string; sourceId: string; chunkIndex: number };

/** A chunk row fetched by ref, embedding included so it can be re-scored. */
export type StoredChunk = ChunkRef & {
  text: string;
  metadata: Record<string, unknown>;
  embedding: Float32Array;
};
