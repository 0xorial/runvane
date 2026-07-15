import { Module } from '@nestjs/common';
import path from 'node:path';
import { DatabaseModule } from '../db/database.module.js';
import { EmbeddingsService } from './embeddings/embeddings.service.js';
import { ForcedRetrievalService } from './retrieval/forced-retrieval.service.js';
import { GRAPH_BUILDERS } from './graph/graph-builder.js';
import { GraphBuilderRegistry } from './graph/graph-builder.registry.js';
import { IngestRunner } from './ingestion/ingest-runner.service.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { LlmGraphBuilder } from './graph/llm-graph-builder.js';
import { KnowledgeWatchService } from './watch/knowledge-watch.service.js';
import { KnowledgeController } from './knowledge.controller.js';
import { RetrieverService } from './retrieval/retriever.service.js';
import { ENTITY_SOURCES } from './sources/entity-source.js';
import { EntitySourceRegistry } from './sources/entity-source.registry.js';
import { FilesEntitySource } from './sources/files.source.js';
import { KNOWLEDGE_DATA_DIR, StorageRegistry } from './store/storage-registry.service.js';

/**
 * The knowledge subsystem. `LlmProviderRegistry` is a global provider, so only the
 * DatabaseModule (for provider settings) needs importing. Entity sources and
 * graph builders are registered as arrays — adding conversations/facts
 * sources or an external graph engine later is a one-line change to the
 * respective factory.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [KnowledgeController],
  providers: [
    {
      provide: KNOWLEDGE_DATA_DIR,
      useFactory: () => process.env.KNOWLEDGE_DATA_DIR ?? path.resolve(process.cwd(), '.knowledge'),
    },
    EmbeddingsService,
    StorageRegistry,
    FilesEntitySource,
    {
      provide: ENTITY_SOURCES,
      useFactory: (files: FilesEntitySource) => [files],
      inject: [FilesEntitySource],
    },
    EntitySourceRegistry,
    LlmGraphBuilder,
    {
      provide: GRAPH_BUILDERS,
      useFactory: (llm: LlmGraphBuilder) => [llm],
      inject: [LlmGraphBuilder],
    },
    GraphBuilderRegistry,
    IngestionService,
    IngestRunner,
    KnowledgeWatchService,
    RetrieverService,
    ForcedRetrievalService,
  ],
  exports: [
    StorageRegistry,
    RetrieverService,
    ForcedRetrievalService,
    IngestionService,
    IngestRunner,
    KnowledgeWatchService,
    EntitySourceRegistry,
    GraphBuilderRegistry,
  ],
})
export class KnowledgeModule {}
