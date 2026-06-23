/**
 * Vector math + (de)serialization for the RAG store.
 *
 * Embeddings are stored L2-normalized as little-endian Float32 blobs, so
 * cosine similarity reduces to a plain dot product at query time.
 */

/** L2-normalize a raw embedding into a Float32Array (unit length, or zero). */
export function l2normalize(values: readonly number[]): Float32Array {
  let sumSq = 0;
  for (const x of values) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(values.length);
  if (norm === 0) return out;
  for (let i = 0; i < values.length; i += 1) out[i] = values[i]! / norm;
  return out;
}

/** Dot product of two equal-length vectors (== cosine when both are normalized). */
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += a[i]! * b[i]!;
  return sum;
}

/** Pack a Float32Array into a Buffer for BLOB storage (copies; no aliasing). */
export function float32ToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer.slice(vec.byteOffset, vec.byteOffset + vec.byteLength));
}

/** Read a BLOB back into a Float32Array (copies to a 4-byte-aligned buffer).
 *  Accepts a Uint8Array since `node:sqlite` returns BLOB columns as Uint8Array. */
export function bufferToFloat32(buf: Uint8Array): Float32Array {
  const aligned = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(aligned);
}
