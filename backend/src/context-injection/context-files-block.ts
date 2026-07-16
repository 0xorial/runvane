/**
 * The exact text block a `files` context-injection entry contributes to the
 * planner prompt. Shared by the planner prompt builder (real turn) and the
 * composer preview endpoint, so the token count the user sees before sending
 * is computed from the same string the model will actually receive — the
 * files twin of knowledge/retrieval/retrieval-context.ts.
 */
export function formatContextFilesBlock(content: string | undefined): string | null {
  // Empty when the scan found nothing to inject (mode 'none', or every
  // candidate skipped); the planner folds nothing in that case.
  if ((content ?? '').trim().length === 0) return null;
  return `[Project context files]\n${content}`;
}
