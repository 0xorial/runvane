import { STUB_EMBEDDING_DIM, hashEmbedding } from './stubLlm.embeddings.js';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot;
}

describe('hashEmbedding', () => {
  it('is deterministic and unit-length with fixed dimension', () => {
    const a = hashEmbedding('the quick brown fox');
    const b = hashEmbedding('the quick brown fox');
    expect(a).toEqual(b);
    expect(a).toHaveLength(STUB_EMBEDDING_DIM);
    expect(Math.sqrt(cosine(a, a))).toBeCloseTo(1, 6);
  });

  it('scores texts sharing tokens higher than unrelated ones', () => {
    const query = hashEmbedding('database migration sqlite');
    const related = hashEmbedding('the sqlite database needs a migration');
    const unrelated = hashEmbedding('tomato basil pasta recipe');
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});
