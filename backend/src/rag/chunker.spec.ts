import { chunkText } from './chunker.js';

describe('chunkText', () => {
  it('returns no chunks for empty/whitespace input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  \n')).toEqual([]);
  });

  it('returns a single trimmed chunk when text fits', () => {
    const chunks = chunkText('  hello world  ', { chunkSize: 100 });
    expect(chunks).toEqual([{ index: 0, text: 'hello world' }]);
  });

  it('splits long text into overlapping, sequentially-indexed chunks', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const chunks = chunkText(text, { chunkSize: 60, overlap: 15 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    // Reassembled chunks cover the whole input (overlap means >= original length).
    expect(chunks.map((c) => c.text).join('\n').length).toBeGreaterThanOrEqual(text.length - chunks.length);
  });

  it('always terminates even with zero overlap', () => {
    const text = 'x'.repeat(5000);
    const chunks = chunkText(text, { chunkSize: 100, overlap: 0 });
    expect(chunks.length).toBe(50);
  });
});
