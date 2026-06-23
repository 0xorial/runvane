/**
 * Deterministic, dependency-free "embedding" for the test stub.
 *
 * Hashes lowercase alphanumeric tokens into a fixed-dimension bag-of-words
 * vector, then L2-normalizes. Texts that share tokens get a higher cosine
 * similarity, so retrieval tests can assert ranking without a live embedding
 * model or network access.
 */
export const STUB_EMBEDDING_DIM = 64;

export function hashEmbedding(text: string, dim: number = STUB_EMBEDDING_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    // FNV-1a hash, folded into [0, dim).
    let h = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[(h >>> 0) % dim] += 1;
  }
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) vec[i] /= norm;
  return vec;
}
