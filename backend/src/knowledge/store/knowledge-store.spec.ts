import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KnowledgeStore } from './knowledge-store.js';
import type { StorageManifest, StoredGraphNode } from './knowledge-store.types.js';
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

describe('KnowledgeStore', () => {
  let dir: string;
  let store: KnowledgeStore;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'runvane-store-'));
    store = new KnowledgeStore(path.join(dir, 's.sqlite'));
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
    expect(store.counts()).toEqual({ chunks: 2, sources: 1, nodes: 0, edges: 0 });
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
    expect(store.counts()).toEqual({ chunks: 1, sources: 1, nodes: 0, edges: 0 });
    expect(store.getSourceHash('files', 'a')).toBe('h2');
    expect(store.queryTopK(l2normalize([0, 0, 1]), 1)[0]!.text).toBe('cherry');
  });

  it('deletes a source and prunes its chunks', () => {
    store.replaceSource({ sourceType: 'files', sourceId: 'a', contentHash: 'h1' }, [
      { chunkIndex: 0, text: 'apple', metadata: {}, embedding: [1, 0, 0] },
    ]);
    expect(store.listSourceIds('files')).toEqual(['a']);
    store.deleteSource('files', 'a');
    expect(store.counts()).toEqual({ chunks: 0, sources: 0, nodes: 0, edges: 0 });
    expect(store.listSourceIds('files')).toEqual([]);
  });

  describe('activity log', () => {
    it('appends and lists newest-first with detail round-trip and limit', () => {
      store.appendLog('created', 'user', { name: 'S', watch: false });
      store.appendLog('ingest', 'watcher', { added: 2, duration_ms: 1234 });
      store.appendLog('source_added', 'agent', { roots: ['/a'], conversation_id: 'c1' });

      const all = store.listLog();
      expect(all.map((e) => e.event)).toEqual(['source_added', 'ingest', 'created']);
      expect(all[0]!.actor).toBe('agent');
      expect(all[0]!.detail).toEqual({ roots: ['/a'], conversation_id: 'c1' });
      expect(all[1]!.detail.added).toBe(2);
      expect(Date.parse(all[0]!.at)).not.toBeNaN();

      expect(store.listLog(2).map((e) => e.event)).toEqual(['source_added', 'ingest']);
    });
  });

  describe('knowledge graph', () => {
    /** Two sources: a.md mentions Alpha+Beta (edge), b.md mentions Beta+Gamma (edge). */
    function seedGraph(): void {
      store.replaceSource({ sourceType: 'files', sourceId: 'a', contentHash: 'h1' }, [
        { chunkIndex: 0, text: 'alpha calls beta', metadata: {}, embedding: [1, 0, 0] },
      ]);
      store.replaceSourceGraph(
        { sourceType: 'files', sourceId: 'a' },
        {
          nodes: [
            { name: 'Alpha', type: 'service', description: 'the alpha service' },
            { name: 'Beta', type: 'queue' },
          ],
          edges: [{ source: 'Alpha', target: 'Beta', relation: 'calls' }],
          mentions: [
            { node: 'Alpha', chunkIndex: 0 },
            { node: 'Beta', chunkIndex: 0 },
          ],
        },
      );
      store.replaceSource({ sourceType: 'files', sourceId: 'b', contentHash: 'h2' }, [
        { chunkIndex: 0, text: 'beta drains into gamma', metadata: {}, embedding: [0, 1, 0] },
      ]);
      store.replaceSourceGraph(
        { sourceType: 'files', sourceId: 'b' },
        {
          nodes: [{ name: 'beta', description: 'a work queue' }, { name: 'Gamma' }],
          edges: [{ source: 'beta', target: 'Gamma', relation: 'drains into' }],
          mentions: [
            { node: 'beta', chunkIndex: 0 },
            { node: 'Gamma', chunkIndex: 0 },
          ],
        },
      );
    }

    it('deduplicates nodes case-insensitively and merges type/description', () => {
      seedGraph();
      expect(store.counts()).toEqual({ chunks: 2, sources: 2, nodes: 3, edges: 2 });
      const beta = store.nodesMentionedIn([{ sourceType: 'files', sourceId: 'b', chunkIndex: 0 }])
        .find((n) => n.name.toLowerCase() === 'beta');
      // 'beta' from b.md merged into the existing 'Beta': type kept, description filled.
      expect(beta?.type).toBe('queue');
      expect(beta?.description).toBe('a work queue');
    });

    it('accumulates distinct description fragments; summarize pass can rewrite them', () => {
      seedGraph();
      const describeAlpha = (description: string): void =>
        store.replaceSourceGraph(
          { sourceType: 'files', sourceId: 'c' },
          {
            nodes: [{ name: 'ALPHA', description }],
            edges: [],
            mentions: [{ node: 'ALPHA', chunkIndex: 0 }],
          },
        );
      store.replaceSource({ sourceType: 'files', sourceId: 'c', contentHash: 'h3' }, [
        { chunkIndex: 0, text: 'alpha again', metadata: {}, embedding: [0, 0, 1] },
      ]);
      const alphaNode = (): StoredGraphNode | undefined =>
        store
          .nodesMentionedIn([{ sourceType: 'files', sourceId: 'c', chunkIndex: 0 }])
          .find((n) => n.name.toLowerCase() === 'alpha');

      // A new fragment appends; an already-contained fragment does not re-append.
      describeAlpha('handles ingress');
      expect(alphaNode()?.description).toBe('the alpha service | handles ingress');
      describeAlpha('handles ingress');
      expect(alphaNode()?.description).toBe('the alpha service | handles ingress');

      // Accumulated nodes surface for the summarize pass and can be rewritten.
      expect(store.nodesWithLongDescriptions(20, 10).map((n) => n.name)).toContain('Alpha');
      const alpha = alphaNode()!;
      store.setNodeDescription(alpha.id, 'Alpha: the ingress service.');
      expect(alphaNode()?.description).toBe('Alpha: the ingress service.');
    });

    it('walks mentions → edges → neighbor chunks across sources', () => {
      seedGraph();
      const seeds = store.nodesMentionedIn([{ sourceType: 'files', sourceId: 'a', chunkIndex: 0 }]);
      expect(seeds.map((n) => n.name).sort()).toEqual(['Alpha', 'Beta']);

      const edges = store.edgesTouching(seeds.map((n) => n.id));
      expect(edges.map((e) => `${e.sourceName} ${e.relation} ${e.targetName}`).sort()).toEqual([
        'Alpha calls Beta',
        'Beta drains into Gamma',
      ]);

      const gammaId = edges.find((e) => e.targetName === 'Gamma')!.targetNodeId;
      const refs = store.mentionRefs([gammaId]);
      expect(refs).toEqual([{ sourceType: 'files', sourceId: 'b', chunkIndex: 0 }]);
      const chunks = store.getChunks(refs);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.text).toBe('beta drains into gamma');
      expect(chunks[0]!.embedding.length).toBe(3);
    });

    it('re-extracting a source replaces its rows; deleting prunes orphans', () => {
      seedGraph();
      // Re-extract a.md with a different graph: old edge gone, no duplicates.
      store.replaceSourceGraph(
        { sourceType: 'files', sourceId: 'a' },
        {
          nodes: [{ name: 'Alpha' }, { name: 'Beta' }],
          edges: [{ source: 'Beta', target: 'Alpha', relation: 'notifies' }],
          mentions: [{ node: 'Alpha', chunkIndex: 0 }, { node: 'Beta', chunkIndex: 0 }],
        },
      );
      let edges = store.edgesTouching(
        store.nodesMentionedIn([{ sourceType: 'files', sourceId: 'a', chunkIndex: 0 }]).map((n) => n.id),
      );
      expect(edges.map((e) => e.relation).sort()).toEqual(['drains into', 'notifies']);

      // Deleting b.md drops its edge+mentions and the now-orphaned Gamma node.
      store.deleteSource('files', 'b');
      expect(store.counts()).toEqual({ chunks: 1, sources: 1, nodes: 2, edges: 1 });
      edges = store.edgesTouching(
        store.nodesMentionedIn([{ sourceType: 'files', sourceId: 'a', chunkIndex: 0 }]).map((n) => n.id),
      );
      expect(edges.map((e) => e.relation)).toEqual(['notifies']);
    });

    it('ignores self-loops, blank names, and duplicate edges', () => {
      store.replaceSource({ sourceType: 'files', sourceId: 'a', contentHash: 'h1' }, [
        { chunkIndex: 0, text: 'x', metadata: {}, embedding: [1, 0, 0] },
      ]);
      store.replaceSourceGraph(
        { sourceType: 'files', sourceId: 'a' },
        {
          nodes: [{ name: 'X' }, { name: '  ' }],
          edges: [
            { source: 'X', target: 'X', relation: 'loops' },
            { source: 'X', target: 'Y', relation: 'uses' },
            { source: 'x', target: 'y', relation: 'USES' },
            { source: 'X', target: '', relation: 'points' },
          ],
          mentions: [{ node: 'X', chunkIndex: 0 }, { node: 'X', chunkIndex: -1 }],
        },
      );
      const counts = store.counts();
      expect(counts.nodes).toBe(2); // X and Y (blank dropped)
      expect(counts.edges).toBe(1); // single deduplicated X→Y edge
    });
  });
});
