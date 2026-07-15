import { Injectable } from '@nestjs/common';
import type { RetrievalHit, RetrievalQuery } from '../../contracts/retrieval.js';
import { RetrieverService } from './retriever.service.js';
import { StorageRegistry } from '../store/storage-registry.service.js';

export const FORCED_RETRIEVAL_DEFAULT_TOP_K = 8;

/**
 * The single implementation behind user-forced retrieval: runs the queries and
 * maps/dedupes raw retriever hits into contract `RetrievalHit`s. Used by both
 * the real turn (conversation processor → retrieval entry) and the composer
 * preview endpoint — one code path, so the preview shows exactly what a send
 * would inject.
 */
@Injectable()
export class ForcedRetrievalService {
  constructor(
    private readonly retriever: RetrieverService,
    private readonly storages: StorageRegistry,
  ) {}

  storageNames(ids: string[]): string[] {
    return ids.map((id) => this.storages.getManifest(id)?.name ?? `${id} (missing)`);
  }

  async run(queries: RetrievalQuery[], storageIds: string[], topK?: number): Promise<RetrievalHit[]> {
    const hits: RetrievalHit[] = [];
    const seen = new Set<string>();
    for (const query of queries) {
      const found = await this.retriever.retrieve({
        storageIds: query.storages ?? storageIds,
        query: query.text,
        topK: topK ?? FORCED_RETRIEVAL_DEFAULT_TOP_K,
      });
      for (const hit of found) {
        // Multiple queries can resurface the same chunk; keep the best-scored
        // first occurrence (retrieve() returns hits sorted by score).
        const key = `${hit.storageId}|${hit.sourceId}|${hit.chunkIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          storage: hit.storageName,
          source: typeof hit.metadata.relativePath === 'string' ? hit.metadata.relativePath : hit.sourceId,
          chunkIndex: hit.chunkIndex,
          score: Number(hit.score.toFixed(4)),
          origin: hit.origin,
          text: hit.text,
        });
      }
    }
    return hits;
  }
}
