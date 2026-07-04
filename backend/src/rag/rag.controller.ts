import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  CreateStorageSchema,
  RagDebugQuerySchema,
  SuggestRootsSchema,
  UpdateStorageSchema,
} from './contracts/rag.js';
import { RootSuggesterService } from './sources/root-suggester.service.js';
import { EmbeddingsService } from './embeddings/embeddings.service.js';
import { EntitySourceRegistry } from './sources/entity-source.registry.js';
import { GraphBuilderRegistry } from './graph/graph-builder.registry.js';
import { IngestRunner } from './ingestion/ingest-runner.service.js';
import { RagWatchService } from './watch/rag-watch.service.js';
import { RetrieverService } from './retrieval/retriever.service.js';
import { StorageRegistry } from './store/storage-registry.service.js';

class CreateStorageDto extends createZodDto(CreateStorageSchema) {}
class UpdateStorageDto extends createZodDto(UpdateStorageSchema) {}
class RagDebugQueryDto extends createZodDto(RagDebugQuerySchema) {}
class SuggestRootsDto extends createZodDto(SuggestRootsSchema) {}

/**
 * The separate RAG ingestion + management surface. Builds/queries the RAG
 * database independently of chat runtime; the agent-facing `rag` tool consumes
 * the same RetrieverService.
 */
@Controller('api/rag')
export class RagController {
  constructor(
    private readonly storages: StorageRegistry,
    private readonly sources: EntitySourceRegistry,
    private readonly ingestRunner: IngestRunner,
    private readonly retriever: RetrieverService,
    private readonly embeddings: EmbeddingsService,
    private readonly graphBuilders: GraphBuilderRegistry,
    private readonly watcher: RagWatchService,
    private readonly rootSuggester: RootSuggesterService,
  ) {}

  /** Explore a base directory and offer storage roots worth indexing —
   *  bounded scan ranked by indexable-file density, refined by one LLM call
   *  when a default provider is configured. */
  @Post('suggest-roots')
  async suggestRoots(@Body() body: SuggestRootsDto) {
    return { base: body.base, candidates: await this.rootSuggester.suggest(body.base) };
  }

  /** Available RAGable entity types (files, later conversations/facts). */
  @Get('sources')
  listSources() {
    return this.sources.list();
  }

  /** Available knowledge-graph builders (llm, later external engines). */
  @Get('graph-builders')
  listGraphBuilders() {
    return this.graphBuilders.list();
  }

  @Get('storages')
  listStorages() {
    return this.storages.listInfos();
  }

  @Post('storages')
  createStorage(@Body() body: CreateStorageDto) {
    if (!this.sources.get(body.entitySource)) {
      throw new BadRequestException(`unknown entity source '${body.entitySource}'`);
    }
    if (!this.embeddings.supports(body.embeddingProviderId)) {
      throw new BadRequestException(
        `provider '${body.embeddingProviderId}' does not support embeddings`,
      );
    }
    const graph = body.graph ?? null;
    if (graph) {
      const builder = this.graphBuilders.get(graph.builder);
      if (!builder) throw new BadRequestException(`unknown graph builder '${graph.builder}'`);
      try {
        builder.validateParams?.(graph.params);
      } catch (error) {
        throw new BadRequestException(
          `graph builder '${graph.builder}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const manifest = this.storages.create({
      name: body.name,
      entitySource: body.entitySource,
      embeddingProviderId: body.embeddingProviderId,
      embeddingModel: body.embeddingModel,
      sourceParams: body.sourceParams,
      chunkSize: body.chunkSize,
      chunkOverlap: body.chunkOverlap,
      graph,
      watch: body.watch,
    });
    this.watcher.reconcile();
    return this.storages.info(manifest.id);
  }

  /** Toggle mutable storage settings (currently: watch). */
  @Patch('storages/:id')
  updateStorage(@Param('id') id: string, @Body() body: UpdateStorageDto) {
    const updated = this.storages.updateManifest(id, { watch: body.watch });
    if (!updated) throw new NotFoundException(`storage '${id}' not found`);
    this.watcher.reconcile();
    return this.storages.info(id);
  }

  @Delete('storages/:id')
  deleteStorage(@Param('id') id: string) {
    const removed = this.storages.delete(id);
    if (!removed) throw new NotFoundException(`storage '${id}' not found`);
    this.watcher.reconcile();
    return { ok: true };
  }

  /** Build/refresh the storage's RAG database from its entity source. Runs as
   *  a registry task (live progress + cancel via /api/tasks); concurrent
   *  requests for the same storage coalesce. */
  @Post('storages/:id/ingest')
  async ingest(@Param('id') id: string) {
    if (!this.storages.getManifest(id)) throw new NotFoundException(`storage '${id}' not found`);
    return this.ingestRunner.run(id, 'manual');
  }

  /** Debug query (UI "test query"); defaults to this storage. Returns
   *  `{ hits, graph }` — graph is null for the 'simple' strategy. */
  @Post('storages/:id/query')
  async query(@Param('id') id: string, @Body() body: RagDebugQueryDto) {
    if (!this.storages.getManifest(id)) throw new NotFoundException(`storage '${id}' not found`);
    const storageIds = body.storageIds && body.storageIds.length > 0 ? body.storageIds : [id];
    const input = { storageIds, query: body.query, topK: body.topK };
    if (body.strategy === 'graph') {
      return this.retriever.retrieveGraph({ ...input, maxHops: body.maxHops });
    }
    return { hits: await this.retriever.retrieve(input), graph: null };
  }
}
