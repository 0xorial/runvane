import { Module } from '@nestjs/common';
import path from 'node:path';
import { DatabaseModule } from '../db/database.module.js';
import { EmbeddingsService } from './embeddings/embeddings.service.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { RagController } from './rag.controller.js';
import { RetrieverService } from './retrieval/retriever.service.js';
import { ENTITY_SOURCES } from './sources/entity-source.js';
import { EntitySourceRegistry } from './sources/entity-source.registry.js';
import { FilesEntitySource } from './sources/files.source.js';
import { RAG_DATA_DIR, StorageRegistry } from './store/storage-registry.service.js';

/**
 * The RAG subsystem. `LlmProviderRegistry` is a global provider, so only the
 * DatabaseModule (for provider settings) needs importing. Entity sources are
 * registered as an array — adding conversations/facts later is a one-line
 * change to the ENTITY_SOURCES factory.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [RagController],
  providers: [
    {
      provide: RAG_DATA_DIR,
      useFactory: () => process.env.RAG_DATA_DIR ?? path.resolve(process.cwd(), '.rag'),
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
    IngestionService,
    RetrieverService,
  ],
  exports: [StorageRegistry, RetrieverService, IngestionService, EntitySourceRegistry],
})
export class RagModule {}
