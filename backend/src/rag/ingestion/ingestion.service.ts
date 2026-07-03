import { Injectable, Logger } from '@nestjs/common';
import { chunkText, type TextChunk } from '../chunker.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import { EntitySourceRegistry } from '../sources/entity-source.registry.js';
import { GraphBuilderRegistry } from '../graph/graph-builder.registry.js';
import { StorageRegistry } from '../store/storage-registry.service.js';
import type { GraphBuilder } from '../graph/graph-builder.js';
import type { IngestResult } from '../contracts/rag.js';
import type { SourceGraphInput } from '../store/rag-store.types.js';

export type IngestProgress = {
  sourceId: string;
  added: number;
  updated: number;
  skipped: number;
};

export type IngestOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: IngestProgress) => void;
};

/**
 * Builds/refreshes one storage's RAG database: enumerate the entity source →
 * chunk → embed → upsert by content hash. Unchanged items are skipped and
 * items that disappeared from the source are pruned, so re-ingest is cheap
 * and idempotent.
 *
 * When the storage has a graph layer configured, each changed item also runs
 * through its GraphBuilder in the same pass. A failed extraction stores the
 * chunks but an empty graph and flags the item (`graph_ok = 0`), so the next
 * ingest retries it instead of hash-skipping a half-ingested item.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly storages: StorageRegistry,
    private readonly sources: EntitySourceRegistry,
    private readonly embeddings: EmbeddingsService,
    private readonly graphBuilders: GraphBuilderRegistry,
  ) {}

  async ingest(storageId: string, options: IngestOptions = {}): Promise<IngestResult> {
    const store = this.storages.open(storageId);
    if (!store) throw new Error(`ingest: unknown storage '${storageId}'`);
    const manifest = store.getManifest();
    if (!manifest) throw new Error(`ingest: storage '${storageId}' has no manifest`);
    const source = this.sources.get(manifest.entitySource);
    if (!source) throw new Error(`ingest: unknown entity source '${manifest.entitySource}'`);
    const graphConfig = manifest.graph ?? null;
    let graphBuilder: GraphBuilder | null = null;
    if (graphConfig) {
      graphBuilder = this.graphBuilders.get(graphConfig.builder);
      if (!graphBuilder) throw new Error(`ingest: unknown graph builder '${graphConfig.builder}'`);
    }

    let added = 0;
    let updated = 0;
    let skipped = 0;
    let removed = 0;
    let graphFailed = 0;
    let dim = manifest.embeddingDim;
    const present = new Set<string>();

    for await (const item of source.enumerate(manifest.sourceParams, options.signal)) {
      options.signal?.throwIfAborted();
      present.add(item.sourceId);

      const existing = store.getSourceState(source.type, item.sourceId);
      if (existing?.contentHash === item.contentHash && (!graphBuilder || existing.graphOk)) {
        skipped += 1;
        continue;
      }

      const chunks = chunkText(item.text, { chunkSize: manifest.chunkSize, overlap: manifest.chunkOverlap });
      if (chunks.length === 0) {
        if (existing !== null) store.deleteSource(source.type, item.sourceId);
        continue;
      }

      const vectors = await this.embeddings.embed(
        manifest.embeddingProviderId,
        manifest.embeddingModel,
        chunks.map((c) => c.text),
        options.signal,
      );
      if (dim === null) dim = vectors[0]?.length ?? null;
      for (const vector of vectors) {
        if (dim !== null && vector.length !== dim) {
          throw new Error(`ingest: inconsistent embedding dim ${vector.length} != ${dim}`);
        }
      }

      store.replaceSource(
        { sourceType: source.type, sourceId: item.sourceId, contentHash: item.contentHash },
        chunks.map((chunk, i) => ({
          chunkIndex: chunk.index,
          text: chunk.text,
          metadata: item.metadata,
          embedding: vectors[i]!,
        })),
      );

      if (graphBuilder && graphConfig) {
        try {
          const graph = await graphBuilder.extract(
            { item, chunks, params: graphConfig.params },
            options.signal,
          );
          store.replaceSourceGraph(
            { sourceType: source.type, sourceId: item.sourceId },
            backfillMentions(graph, chunks),
          );
        } catch (error) {
          options.signal?.throwIfAborted();
          // Keep the chunks, clear this item's graph (stale mentions would
          // point at replaced chunk indexes), and flag it for retry.
          store.replaceSourceGraph(
            { sourceType: source.type, sourceId: item.sourceId },
            { nodes: [], edges: [], mentions: [] },
          );
          store.setSourceGraphStatus(source.type, item.sourceId, false);
          graphFailed += 1;
          this.logger.warn(
            `ingest ${storageId}: graph extraction failed for '${item.sourceId}': ${String(error)}`,
          );
        }
      }

      if (existing === null) added += 1;
      else updated += 1;
      options.onProgress?.({ sourceId: item.sourceId, added, updated, skipped });
    }

    for (const sourceId of store.listSourceIds(source.type)) {
      if (!present.has(sourceId)) {
        store.deleteSource(source.type, sourceId);
        removed += 1;
      }
    }

    this.storages.updateManifest(storageId, {
      embeddingDim: dim,
      lastIngestedAt: new Date().toISOString(),
    });
    const counts = store.counts();
    this.logger.log(
      `ingest ${storageId}: +${added} ~${updated} =${skipped} -${removed} (${counts.chunks} chunks` +
        (graphConfig ? `, ${counts.nodes} nodes / ${counts.edges} edges, ${graphFailed} graph failures` : '') +
        `)`,
    );
    return {
      storageId,
      added,
      updated,
      skipped,
      removed,
      totalChunks: counts.chunks,
      totalSources: counts.sources,
      embeddingDim: dim,
      graph: graphConfig ? { nodes: counts.nodes, edges: counts.edges, failedSources: graphFailed } : null,
    };
  }
}

/**
 * Ensure every node has chunk provenance: nodes the builder gave no `mentions`
 * entry get one for each chunk whose text contains the node name
 * (case-insensitive). Builders without chunk-level output thus still support
 * mention-based graph expansion wherever a name literally appears.
 */
export function backfillMentions(graph: SourceGraphInput, chunks: TextChunk[]): SourceGraphInput {
  const covered = new Set(graph.mentions.map((m) => m.node.trim().toLowerCase()));
  const names = new Set<string>();
  for (const node of graph.nodes) names.add(node.name);
  for (const edge of graph.edges) {
    names.add(edge.source);
    names.add(edge.target);
  }

  const extra: SourceGraphInput['mentions'] = [];
  for (const name of names) {
    const needle = name.trim().toLowerCase();
    if (!needle || covered.has(needle)) continue;
    for (const chunk of chunks) {
      if (chunk.text.toLowerCase().includes(needle)) extra.push({ node: name, chunkIndex: chunk.index });
    }
  }
  return extra.length === 0 ? graph : { ...graph, mentions: [...graph.mentions, ...extra] };
}
