// Rough client-side token estimate for text that is still streaming, before the
// provider reports real usage. Uses the common ~4-characters-per-token heuristic,
// which is close enough for a live, approximate counter. Not a substitute for the
// provider's authoritative token counts once the stream completes.
export function estimateTokenCount(...texts: (string | null | undefined)[]): number {
  let chars = 0;
  for (const text of texts) {
    if (text) chars += text.length;
  }
  return Math.ceil(chars / 4);
}
