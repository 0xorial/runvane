export type TextChunk = { index: number; text: string };

export type ChunkOptions = { chunkSize?: number; overlap?: number };

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 150;

/**
 * Split text into overlapping, character-bounded chunks, snapping the cut to a
 * newline in the latter half of the window when possible (so chunks rarely
 * split mid-line). Empty/whitespace input yields no chunks. `start` always
 * advances, so this can't loop forever.
 */
export function chunkText(raw: string, options: ChunkOptions = {}): TextChunk[] {
  const chunkSize = Math.max(1, Math.floor(options.chunkSize ?? DEFAULT_CHUNK_SIZE));
  const overlap = Math.min(Math.max(0, Math.floor(options.overlap ?? DEFAULT_OVERLAP)), chunkSize - 1);

  const text = raw.replace(/\r\n/g, '\n');
  if (text.trim().length === 0) return [];
  if (text.length <= chunkSize) return [{ index: 0, text: text.trim() }];

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    if (end < text.length) {
      const newlineAt = text.lastIndexOf('\n', end);
      // Only honor the newline if it lands in the back half of the window,
      // otherwise we'd produce tiny chunks.
      if (newlineAt > start + chunkSize * 0.5) end = newlineAt + 1;
    }
    const piece = text.slice(start, end).trim();
    if (piece.length > 0) chunks.push({ index: index++, text: piece });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}
