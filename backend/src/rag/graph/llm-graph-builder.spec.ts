import { parseExtractionReply } from './llm-graph-builder.js';

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
