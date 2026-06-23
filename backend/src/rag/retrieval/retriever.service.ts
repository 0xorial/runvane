import { Injectable } from '@nestjs/common';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import { StorageRegistry } from '../store/storage-registry.service.js';
import { l2normalize } from '../vector.js';
import type { RagStore } from '../store/rag-store.js';
import type { RagQueryHit } from '../contracts/rag.js';

export type RetrieveInput = {
  storageIds: string[];
  query: string;
  topK: number;
  signal?: AbortSignal;
};

type ModelBucket = {
  providerId: string;
  model: string;
  storages: Array<{ id: string; name: string; store: RagStore }>;
};

/**
 * The "simple" RAG strategy with multi-storage fan-out: embed the query once
 * per (provider, model) vector space, run brute-force top-k against each
 * selected storage, then merge by score. Query rewriting / sub-query fan-out
 * is a separate (Phase 2) strategy layered on top of this.
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

    // Group storages by their embedding vector space so we embed the query once each.
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

    const hits: RagQueryHit[] = [];
    for (const bucket of buckets.values()) {
      input.signal?.throwIfAborted();
      const raw = await this.embeddings.embedOne(bucket.providerId, bucket.model, input.query, input.signal);
      const queryVec = l2normalize(raw);
      for (const { id, name, store } of bucket.storages) {
        for (const hit of store.queryTopK(queryVec, topK)) {
          hits.push({
            storageId: id,
            storageName: name,
            sourceType: hit.sourceType,
            sourceId: hit.sourceId,
            chunkIndex: hit.chunkIndex,
            text: hit.text,
            score: hit.score,
            metadata: hit.metadata,
          });
        }
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }
}
