import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { CreateStorageSchema, RagDebugQuerySchema } from './contracts/rag.js';
import { EmbeddingsService } from './embeddings/embeddings.service.js';
import { EntitySourceRegistry } from './sources/entity-source.registry.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { RetrieverService } from './retrieval/retriever.service.js';
import { StorageRegistry } from './store/storage-registry.service.js';

class CreateStorageDto extends createZodDto(CreateStorageSchema) {}
class RagDebugQueryDto extends createZodDto(RagDebugQuerySchema) {}

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
    private readonly ingestion: IngestionService,
    private readonly retriever: RetrieverService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** Available RAGable entity types (files, later conversations/facts). */
  @Get('sources')
  listSources() {
    return this.sources.list();
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
    const manifest = this.storages.create({
      name: body.name,
      entitySource: body.entitySource,
      embeddingProviderId: body.embeddingProviderId,
      embeddingModel: body.embeddingModel,
      sourceParams: body.sourceParams,
      chunkSize: body.chunkSize,
      chunkOverlap: body.chunkOverlap,
    });
    return this.storages.info(manifest.id);
  }

  @Delete('storages/:id')
  deleteStorage(@Param('id') id: string) {
    const removed = this.storages.delete(id);
    if (!removed) throw new NotFoundException(`storage '${id}' not found`);
    return { ok: true };
  }

  /** Build/refresh the storage's RAG database from its entity source. */
  @Post('storages/:id/ingest')
  async ingest(@Param('id') id: string) {
    if (!this.storages.getManifest(id)) throw new NotFoundException(`storage '${id}' not found`);
    return this.ingestion.ingest(id);
  }

  /** Debug similarity query (UI "test query"); defaults to this storage. */
  @Post('storages/:id/query')
  async query(@Param('id') id: string, @Body() body: RagDebugQueryDto) {
    if (!this.storages.getManifest(id)) throw new NotFoundException(`storage '${id}' not found`);
    const storageIds = body.storageIds && body.storageIds.length > 0 ? body.storageIds : [id];
    return this.retriever.retrieve({ storageIds, query: body.query, topK: body.topK });
  }
}
