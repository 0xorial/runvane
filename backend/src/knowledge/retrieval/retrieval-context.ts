/**
 * The exact text block a forced retrieval contributes to the planner prompt.
 * Shared by the planner prompt builder (real turn) and the composer preview
 * endpoint, so the token count the user sees before sending is computed from
 * the same string the model will actually receive.
 */

export type RetrievalContextInput = {
  storages: string[];
  queries: Array<{ text: string }>;
  state: 'pending' | 'done' | 'failed';
  hits: Array<{ storage: string; source: string; score: number; text: string }>;
  error?: string;
};

export function formatRetrievalContext(input: RetrievalContextInput): string {
  const queries = input.queries.map((q) => `"${q.text}"`).join(', ');
  const header = `[User-requested retrieval over storage(s): ${input.storages.join(', ') || 'none'} — query: ${queries}]`;
  if (input.state === 'failed') {
    return `${header}\nRetrieval FAILED: ${input.error ?? 'unknown error'}. Answer from the conversation or say what is missing; do not pretend the storages were consulted.`;
  }
  if (input.state === 'pending') {
    // Unreachable in the normal flow (the entry resolves before the planner
    // starts), but a replayed/interrupted turn can surface one.
    return `${header}\nRetrieval did not complete for this message.`;
  }
  if (input.hits.length === 0) {
    return `${header}\nNo relevant content was found. Say so if the answer depends on it; do not invent grounding.`;
  }
  const blocks = input.hits.map(
    (hit, i) => `--- [${i + 1}] ${hit.storage} / ${hit.source} (score ${hit.score})\n${hit.text}`,
  );
  return `${header}\nGround your answer in these excerpts where relevant and name the sources you used:\n${blocks.join('\n')}`;
}

/** Rough tokens-from-chars estimate (~4 chars/token); always label it "~". */
export function estimateContextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
