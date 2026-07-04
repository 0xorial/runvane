import { mapSidecarReply } from './lightrag-graph-builder.js';

describe('mapSidecarReply', () => {
  it('maps entities and relations into the normalized contract, mentions empty', () => {
    const graph = mapSidecarReply({
      entities: [
        { name: 'Alpha Service', type: 'organization', description: 'handles ingress' },
        { name: '  ', type: 'x' }, // blank name dropped
        { name: 'Beta Queue', type: '', description: '' }, // empty fields → undefined
      ],
      relations: [
        { source: 'Alpha Service', target: 'Beta Queue', relation: 'publishes, queues', description: 'via RPC' },
        { source: 'Alpha Service', target: '', relation: 'x' }, // blank endpoint dropped
        { source: 'Beta Queue', target: 'Alpha Service' }, // no keywords → fallback label
      ],
    });
    expect(graph.nodes).toEqual([
      { name: 'Alpha Service', type: 'organization', description: 'handles ingress' },
      { name: 'Beta Queue', type: undefined, description: undefined },
    ]);
    expect(graph.edges).toEqual([
      { source: 'Alpha Service', target: 'Beta Queue', relation: 'publishes, queues', description: 'via RPC' },
      { source: 'Beta Queue', target: 'Alpha Service', relation: 'related to', description: undefined },
    ]);
    // LightRAG chunks its own way — chunk provenance comes from ingestion's
    // substring backfill, so the builder itself reports no mentions.
    expect(graph.mentions).toEqual([]);
  });

  it('tolerates missing/garbage fields', () => {
    expect(mapSidecarReply({})).toEqual({ nodes: [], edges: [], mentions: [] });
    expect(
      mapSidecarReply({ entities: [{ name: 42 }], relations: [{ source: 1, target: 2 }] } as never),
    ).toEqual({ nodes: [], edges: [], mentions: [] });
  });
});
