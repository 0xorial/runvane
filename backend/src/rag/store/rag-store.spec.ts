import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RagStore } from './rag-store.js';
import type { StorageManifest } from './rag-store.types.js';
import { l2normalize } from '../vector.js';

const MANIFEST: StorageManifest = {
  id: 'test',
  name: 'Test',
  entitySource: 'files',
  embeddingProviderId: 'stub',
  embeddingModel: 'stub-embed',
  embeddingDim: 3,
  sourceParams: { roots: ['/tmp'] },
  chunkSize: 1000,
  chunkOverlap: 150,
  createdAt: new Date().toISOString(),
  lastIngestedAt: null,
};

describe('RagStore', () => {
  let dir: string;
  let store: RagStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'runvane-store-'));
    store = new RagStore(path.join(dir, 's.sqlite'));
  });

  afterEach(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips the manifest', () => {
    store.setManifest(MANIFEST);
    expect(store.getManifest()).toEqual(MANIFEST);
  });

  it('upserts chunks, tracks counts + source hash, and ranks by cosine', () => {
    store.replaceSource({ sourceType: 'files', sourceId: 'a', contentHash: 'h1' }, [
      { chunkIndex: 0, text: 'apple', metadata: { path: 'a' }, embedding: [1, 0, 0] },
      { chunkIndex: 1, text: 'banana', metadata: { path: 'a' }, embedding: [0, 1, 0] },
    ]);
    expect(store.counts()).toEqual({ chunks: 2, sources: 1 });
    expect(store.getSourceHash('files', 'a')).toBe('h1');
    expect(store.getSourceHash('files', 'missing')).toBeNull();

    const hits = store.queryTopK(l2normalize([1, 0, 0]), 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toBe('apple');
    expect(hits[0]!.score).toBeCloseTo(1, 6);
    expect(hits[0]!.metadata).toEqual({ path: 'a' });
  });

  it('replaceSource swaps an item in place (no duplicate chunks)', () => {
    store.replaceSource({ sourceType: 'files', sourceId: 'a', contentHash: 'h1' }, [
      { chunkIndex: 0, text: 'apple', metadata: {}, embedding: [1, 0, 0] },
    ]);
    store.replaceSource({ sourceType: 'files', sourceId: 'a', contentHash: 'h2' }, [
      { chunkIndex: 0, text: 'cherry', metadata: {}, embedding: [0, 0, 1] },
    ]);
    expect(store.counts()).toEqual({ chunks: 1, sources: 1 });
    expect(store.getSourceHash('files', 'a')).toBe('h2');
    expect(store.queryTopK(l2normalize([0, 0, 1]), 1)[0]!.text).toBe('cherry');
  });

  it('deletes a source and prunes its chunks', () => {
    store.replaceSource({ sourceType: 'files', sourceId: 'a', contentHash: 'h1' }, [
      { chunkIndex: 0, text: 'apple', metadata: {}, embedding: [1, 0, 0] },
    ]);
    expect(store.listSourceIds('files')).toEqual(['a']);
    store.deleteSource('files', 'a');
    expect(store.counts()).toEqual({ chunks: 0, sources: 0 });
    expect(store.listSourceIds('files')).toEqual([]);
  });
});
