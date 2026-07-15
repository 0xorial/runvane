import { bufferToFloat32, dot, float32ToBuffer, l2normalize } from './vector.js';

describe('vector', () => {
  it('l2normalize returns a unit vector', () => {
    const v = l2normalize([3, 4]);
    expect(Math.hypot(v[0]!, v[1]!)).toBeCloseTo(1, 6);
    expect(v[0]).toBeCloseTo(0.6, 6);
    expect(v[1]).toBeCloseTo(0.8, 6);
  });

  it('l2normalize handles the zero vector without NaN', () => {
    const v = l2normalize([0, 0, 0]);
    expect([...v]).toEqual([0, 0, 0]);
  });

  it('dot of normalized vectors equals cosine similarity', () => {
    const a = l2normalize([1, 0]);
    const b = l2normalize([1, 1]);
    expect(dot(a, b)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(dot(a, l2normalize([0, 1]))).toBeCloseTo(0, 6);
  });

  it('round-trips a Float32Array through a Buffer', () => {
    const original = l2normalize([0.1, 0.2, 0.3, 0.4]);
    const restored = bufferToFloat32(float32ToBuffer(original));
    expect([...restored]).toEqual([...original]);
  });
});
