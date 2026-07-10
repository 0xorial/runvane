import { mergeExtractions, parseExtractionReply } from './llm-graph-builder.js';

describe('parseExtractionReply', () => {
  it('parses a clean reply into nodes, edges, and mentions', () => {
    const graph = parseExtractionReply(
      JSON.stringify({
        entities: [
          { name: 'Alpha', type: 'service', description: 'ingress service', chunks: [0, 2] },
          { name: 'Beta', chunks: [1] },
        ],
        relations: [{ source: 'Alpha', target: 'Beta', relation: 'calls', description: 'via RPC' }],
      }),
    );
    expect(graph.nodes).toEqual([
      { name: 'Alpha', type: 'service', description: 'ingress service' },
      { name: 'Beta', type: undefined, description: undefined },
    ]);
    expect(graph.edges).toEqual([
      { source: 'Alpha', target: 'Beta', relation: 'calls', description: 'via RPC' },
    ]);
    expect(graph.mentions).toEqual([
      { node: 'Alpha', chunkIndex: 0 },
      { node: 'Alpha', chunkIndex: 2 },
      { node: 'Beta', chunkIndex: 1 },
    ]);
  });

  it('tolerates fenced / commentary-wrapped replies', () => {
    const graph = parseExtractionReply(
      'Here is the graph:\n```json\n{"entities":[{"name":"X"}],"relations":[]}\n```\nDone.',
    );
    expect(graph.nodes.map((n) => n.name)).toEqual(['X']);
  });

  it('drops blank names and clamps entity/relation counts', () => {
    const graph = parseExtractionReply(
      JSON.stringify({
        entities: [{ name: '  ' }, ...Array.from({ length: 60 }, (_, i) => ({ name: `E${i}` }))],
        relations: Array.from({ length: 120 }, (_, i) => ({
          source: `E${i % 40}`,
          target: `E${(i + 1) % 40}`,
          relation: 'links',
        })),
      }),
    );
    expect(graph.nodes.length).toBeLessThanOrEqual(50);
    expect(graph.edges.length).toBeLessThanOrEqual(100);
    expect(graph.nodes.every((n) => n.name.trim().length > 0)).toBe(true);
  });

  it('throws on a reply without JSON', () => {
    expect(() => parseExtractionReply('no graph here')).toThrow(/no JSON object/);
  });
});

describe('mergeExtractions', () => {
  it('adds new nodes/edges/mentions and reports what the round contributed', () => {
    const base = {
      nodes: [{ name: 'Alpha', type: 'service', description: 'ingress' }],
      edges: [{ source: 'Alpha', target: 'Beta', relation: 'calls' }],
      mentions: [{ node: 'Alpha', chunkIndex: 0 }],
    };
    const extra = {
      nodes: [{ name: 'Gamma' }],
      edges: [{ source: 'Beta', target: 'Gamma', relation: 'drains into' }],
      mentions: [{ node: 'Gamma', chunkIndex: 1 }],
    };
    const { merged, addedNodes, addedEdges } = mergeExtractions(base, extra);
    expect(addedNodes).toBe(1);
    expect(addedEdges).toBe(1);
    expect(merged.nodes.map((n) => n.name)).toEqual(['Alpha', 'Gamma']);
    expect(merged.edges).toHaveLength(2);
    expect(merged.mentions).toHaveLength(2);
  });

  it('dedupes case/whitespace-insensitively and accumulates distinct descriptions', () => {
    const base = {
      nodes: [{ name: 'Alpha', description: 'ingress' }],
      edges: [{ source: 'Alpha', target: 'Beta', relation: 'calls' }],
      mentions: [{ node: 'Alpha', chunkIndex: 0 }],
    };
    const extra = {
      nodes: [
        { name: '  alpha ', type: 'service', description: 'ingress' },
        { name: 'ALPHA', description: 'fronts the API' },
      ],
      edges: [{ source: 'alpha', target: 'BETA', relation: 'CALLS' }],
      mentions: [{ node: 'alpha', chunkIndex: 0 }],
    };
    const { merged, addedNodes, addedEdges } = mergeExtractions(base, extra);
    expect(addedNodes).toBe(0);
    expect(addedEdges).toBe(0);
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]).toEqual({
      name: 'Alpha',
      type: 'service',
      description: 'ingress | fronts the API',
    });
    expect(merged.edges).toHaveLength(1);
    expect(merged.mentions).toHaveLength(1);
  });

  it('does not mutate its inputs', () => {
    const base = { nodes: [{ name: 'Alpha' }], edges: [], mentions: [] };
    const extra = { nodes: [{ name: 'alpha', type: 'service' }], edges: [], mentions: [] };
    mergeExtractions(base, extra);
    expect(base.nodes[0]).toEqual({ name: 'Alpha' });
  });
});
