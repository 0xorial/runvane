import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StubLlmProvider } from '../llmProviders/providers/stubLlm.js';
import type { LlmProviderRegistry } from '../llmProviders/registry.js';
import type { LlmProviderSettingsRepo } from '../db/repositories/llm-provider-settings.repo.js';
import { EmbeddingsService } from './embeddings/embeddings.service.js';
import { EntitySourceRegistry } from './sources/entity-source.registry.js';
import { FilesEntitySource } from './sources/files.source.js';
import { IngestionService } from './ingestion/ingestion.service.js';
import { RetrieverService } from './retrieval/retriever.service.js';
import { StorageRegistry } from './store/storage-registry.service.js';

/**
 * End-to-end RAG slice with deterministic stub embeddings: create a Files
 * storage over a temp dir, ingest, then retrieve — proving every layer wires
 * together and semantic ranking actually works without a live model.
 */
describe('RAG pipeline (files + simple retrieval)', () => {
  let docsDir: string;
  let ragDir: string;
  let storages: StorageRegistry;
  let ingestion: IngestionService;
  let retriever: RetrieverService;

  beforeEach(async () => {
    docsDir = await mkdtemp(path.join(os.tmpdir(), 'runvane-docs-'));
    ragDir = await mkdtemp(path.join(os.tmpdir(), 'runvane-rag-'));
    await writeFile(
      path.join(docsDir, 'db.md'),
      'SQLite database migrations are managed by Prisma. Run the migration to update the schema.',
    );
    await writeFile(
      path.join(docsDir, 'cooking.md'),
      'A simple tomato basil pasta recipe: boil water, add salt, cook the pasta, stir the sauce.',
    );
    await writeFile(
      path.join(docsDir, 'network.md'),
      'TCP socket connections carry packets across the network with varying latency and throughput.',
    );

    const stub = new StubLlmProvider();
    const registry = { get: () => stub } as unknown as LlmProviderRegistry;
    const settingsRepo = { getProviderSettings: async () => ({}) } as unknown as LlmProviderSettingsRepo;
    const embeddings = new EmbeddingsService(registry, settingsRepo);

    storages = new StorageRegistry(ragDir);
    const sources = new EntitySourceRegistry([new FilesEntitySource()]);
    ingestion = new IngestionService(storages, sources, embeddings);
    retriever = new RetrieverService(storages, embeddings);
  });

  afterEach(async () => {
    storages.onModuleDestroy();
    await rm(docsDir, { recursive: true, force: true });
    await rm(ragDir, { recursive: true, force: true });
  });

  function createStorage(): string {
    return storages.create({
      name: 'docs',
      entitySource: 'files',
      embeddingProviderId: 'stub',
      embeddingModel: 'stub-embed',
      sourceParams: { roots: [docsDir] },
    }).id;
  }

  it('ingests files and records dimension + counts', async () => {
    const id = createStorage();
    const result = await ingestion.ingest(id);
    expect(result.totalSources).toBe(3);
    expect(result.added).toBe(3);
    expect(result.totalChunks).toBeGreaterThanOrEqual(3);
    expect(result.embeddingDim).toBeGreaterThan(0);
    expect(storages.getManifest(id)?.lastIngestedAt).toBeTruthy();
  });

  it('retrieves the semantically closest document first', async () => {
    const id = createStorage();
    await ingestion.ingest(id);

    const hits = await retriever.retrieve({
      storageIds: [id],
      query: 'how do sqlite database migrations work',
      topK: 3,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.sourceId).toContain('db.md');
    expect(hits[0]!.score).toBeGreaterThan(0);
    // Scores are sorted descending.
    for (let i = 1; i < hits.length; i += 1) expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
  });

  it('is incremental: re-ingest skips unchanged, re-embeds changed', async () => {
    const id = createStorage();
    await ingestion.ingest(id);

    const second = await ingestion.ingest(id);
    expect(second.added).toBe(0);
    expect(second.skipped).toBe(3);

    await writeFile(path.join(docsDir, 'db.md'), 'Completely different content about quantum entanglement.');
    const third = await ingestion.ingest(id);
    expect(third.updated).toBe(1);
    expect(third.skipped).toBe(2);
  });

  it('prunes documents that disappear from the source', async () => {
    const id = createStorage();
    await ingestion.ingest(id);
    await rm(path.join(docsDir, 'network.md'));
    const result = await ingestion.ingest(id);
    expect(result.removed).toBe(1);
    expect(result.totalSources).toBe(2);
  });
});
