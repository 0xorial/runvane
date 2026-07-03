import { Injectable } from '@nestjs/common';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import { StorageRegistry } from '../store/storage-registry.service.js';
import { dot, l2normalize } from '../vector.js';
import type { RagStore } from '../store/rag-store.js';
import type { ChunkRef, StoredGraphEdge } from '../store/rag-store.types.js';
import type { RagGraphContext, RagQueryHit, RagRetrieveResult } from '../contracts/rag.js';

export type RetrieveInput = {
  storageIds: string[];
  query: string;
  topK: number;
  signal?: AbortSignal;
};

export type GraphRetrieveInput = RetrieveInput & {
  /** How far to walk the knowledge graph from the seed chunks' entities. */
  maxHops: number;
};

type ModelBucket = {
  providerId: string;
  model: string;
  storages: Array<{ id: string; name: string; store: RagStore }>;
};

/** Bound the graph-expansion working set so a hub node can't explode a query. */
const MAX_GRAPH_CHUNK_CANDIDATES = 64;
const MAX_CONTEXT_ENTITIES = 30;
const MAX_CONTEXT_RELATIONS = 40;

/**
 * Retrieval strategies over the configured storages, with multi-storage
 * fan-out: embed the query once per (provider, model) vector space, run
 * brute-force top-k against each selected storage, then merge by score.
 *
 * - 'simple': vector similarity only.
 * - 'graph': vector seeds, then walk the storage's knowledge graph from the
 *   entities those seeds mention (≤ maxHops), pull in chunks that mention the
 *   discovered entities, and surface the traversed entities/relations as
 *   context. Graph-found chunks are additive — up to ceil(topK/2) rows on top
 *   of the vector top-k. By construction they score below the seeds (else
 *   they'd *be* seeds), so folding them into one score-merged top-k would
 *   always drop exactly the connected-but-lexically-far chunks the graph
 *   exists to find; and stealing seed slots instead would hide the user's
 *   best direct matches.
 */
@Injectable()
export class RetrieverService {
  constructor(
    private readonly storages: StorageRegistry,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async retrieve(input: RetrieveInput): Promise<RagQueryHit[]> {
    const topK = Math.max(0, Math.floor(input.topK));
    if (!input.query.trim() || input.storageIds.length === 0 || topK === 0) return [];

    const hits: RagQueryHit[] = [];
    for (const { queryVec, storages } of await this.embedBuckets(input)) {
      for (const { id, name, store } of storages) {
        hits.push(...seedHits(store, id, name, queryVec, topK));
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  async retrieveGraph(input: GraphRetrieveInput): Promise<RagRetrieveResult> {
    const topK = Math.max(0, Math.floor(input.topK));
    if (!input.query.trim() || input.storageIds.length === 0 || topK === 0) {
      return { hits: [], graph: null };
    }
    const maxHops = Math.min(Math.max(1, Math.floor(input.maxHops)), 3);

    const seeds: RagQueryHit[] = [];
    const graphOnly: RagQueryHit[] = [];
    const entities: RagGraphContext['entities'] = [];
    const relations: RagGraphContext['relations'] = [];
    const seenEntities = new Set<string>();
    const seenRelations = new Set<string>();

    for (const { queryVec, storages } of await this.embedBuckets(input)) {
      for (const { id, name, store } of storages) {
        input.signal?.throwIfAborted();
        const storageSeeds = seedHits(store, id, name, queryVec, topK);
        seeds.push(...storageSeeds);

        // Seed chunks → mentioned entities → ≤ maxHops of edges.
        const seedNodes = store.nodesMentionedIn(storageSeeds.map(hitRef));
        if (seedNodes.length === 0) continue;
        const visited = new Set(seedNodes.map((n) => n.id));
        let frontier = [...visited];
        const edges: StoredGraphEdge[] = [];
        const seenEdges = new Set<string>();
        for (let hop = 0; hop < maxHops && frontier.length > 0; hop += 1) {
          const next: number[] = [];
          for (const edge of store.edgesTouching(frontier)) {
            const key = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.relation.toLowerCase()}`;
            if (!seenEdges.has(key)) {
              seenEdges.add(key);
              edges.push(edge);
            }
            for (const nodeId of [edge.sourceNodeId, edge.targetNodeId]) {
              if (!visited.has(nodeId)) {
                visited.add(nodeId);
                next.push(nodeId);
              }
            }
          }
          frontier = next;
        }

        // Chunks mentioning any discovered entity, minus the seeds themselves,
        // re-scored against the query in this bucket's vector space.
        const seedRefKeys = new Set(storageSeeds.map((h) => refKey(hitRef(h))));
        const refs = store
          .mentionRefs([...visited])
          .filter((ref) => !seedRefKeys.has(refKey(ref)))
          .slice(0, MAX_GRAPH_CHUNK_CANDIDATES);
        for (const chunk of store.getChunks(refs)) {
          graphOnly.push({
            storageId: id,
            storageName: name,
            sourceType: chunk.sourceType,
            sourceId: chunk.sourceId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            score: dot(queryVec, chunk.embedding),
            metadata: chunk.metadata,
            origin: 'graph',
          });
        }

        for (const node of store.getNodes([...visited])) {
          const key = node.name.toLowerCase();
          if (seenEntities.has(key)) continue;
          seenEntities.add(key);
          entities.push({ name: node.name, type: node.type, description: node.description });
        }
        for (const edge of edges) {
          const key = `${edge.sourceName}|${edge.relation}|${edge.targetName}`.toLowerCase();
          if (seenRelations.has(key)) continue;
          seenRelations.add(key);
          relations.push({
            source: edge.sourceName,
            relation: edge.relation,
            target: edge.targetName,
            description: edge.description,
          });
        }
      }
    }

    seeds.sort((a, b) => b.score - a.score);
    graphOnly.sort((a, b) => b.score - a.score);
    const hits = [...seeds.slice(0, topK), ...graphOnly.slice(0, Math.ceil(topK / 2))].sort(
      (a, b) => b.score - a.score,
    );

    const graph: RagGraphContext | null =
      entities.length > 0
        ? {
            entities: entities.slice(0, MAX_CONTEXT_ENTITIES),
            relations: relations.slice(0, MAX_CONTEXT_RELATIONS),
          }
        : null;
    return { hits, graph };
  }

  /** Group storages by embedding vector space and embed the query once per space. */
  private async embedBuckets(
    input: RetrieveInput,
  ): Promise<Array<{ queryVec: Float32Array; storages: ModelBucket['storages'] }>> {
    const buckets = new Map<string, ModelBucket>();
    for (const id of input.storageIds) {
      const store = this.storages.open(id);
      const manifest = store?.getManifest();
      if (!store || !manifest) continue;
      const key = `${manifest.embeddingProviderId} ${manifest.embeddingModel}`;
      const bucket =
        buckets.get(key) ??
        { providerId: manifest.embeddingProviderId, model: manifest.embeddingModel, storages: [] };
      bucket.storages.push({ id, name: manifest.name, store });
      buckets.set(key, bucket);
    }

    const out: Array<{ queryVec: Float32Array; storages: ModelBucket['storages'] }> = [];
    for (const bucket of buckets.values()) {
      input.signal?.throwIfAborted();
      const raw = await this.embeddings.embedOne(bucket.providerId, bucket.model, input.query, input.signal);
      out.push({ queryVec: l2normalize(raw), storages: bucket.storages });
    }
    return out;
  }
}

function seedHits(
  store: RagStore,
  storageId: string,
  storageName: string,
  queryVec: Float32Array,
  topK: number,
): RagQueryHit[] {
  return store.queryTopK(queryVec, topK).map((hit) => ({
    storageId,
    storageName,
    sourceType: hit.sourceType,
    sourceId: hit.sourceId,
    chunkIndex: hit.chunkIndex,
    text: hit.text,
    score: hit.score,
    metadata: hit.metadata,
    origin: 'seed' as const,
  }));
}

function hitRef(hit: RagQueryHit): ChunkRef {
  return { sourceType: hit.sourceType, sourceId: hit.sourceId, chunkIndex: hit.chunkIndex };
}

function refKey(ref: ChunkRef): string {
  return `${ref.sourceType} ${ref.sourceId} ${ref.chunkIndex}`;
}
