import { buildPlannerSyntaxRegistry, PLAINTEXT_SYNTAX_NAME } from './plannerSyntax/index.js';
import { plainTextPlannerOutput } from './plannerSyntax/plannerOutput.js';

// Back-compat re-exports: these helpers used to be defined here and are imported
// from this module elsewhere (notably plannerProvider's streaming mirror).
export {
  extractAssistantOutputFromJsonLike,
  extractLastBalancedJsonObject,
  parseJsonObjectLoose,
} from './plannerSyntax/plannerOutput.js';
export type { ParsedPlannerOutput } from './plannerSyntax/plannerOutput.js';

import type { ParsedPlannerOutput } from './plannerSyntax/plannerOutput.js';

// One registry per process: registration sorts once, sniffing is stateless.
const PLANNER_SYNTAXES = buildPlannerSyntaxRegistry();

/**
 * Parse a planner reply into {@link ParsedPlannerOutput}, auto-detecting which
 * markup the model actually used (JSON, Gemma `<|tool_call>` blocks, XML tags,
 * …) via the planner syntax registry and committing to the best match. Adding a
 * new dialect is a change in `./plannerSyntax/`, not here.
 *
 * `onJsonParseFailed` fires only when no structured syntax matched and the reply
 * fell through to the plaintext catch-all, preserving the previous diagnostic.
 */
export function parsePlannerOutput(
  reply: string,
  onJsonParseFailed?: (reply: string) => void,
): ParsedPlannerOutput {
  const raw = String(reply ?? '');
  const parser = PLANNER_SYNTAXES.createSelector().observe(raw, { final: true });
  if (!parser) {
    // Unreachable while the plaintext catch-all is registered; stay safe anyway.
    onJsonParseFailed?.(raw);
    return plainTextPlannerOutput(raw);
  }
  if (parser.name === PLAINTEXT_SYNTAX_NAME) onJsonParseFailed?.(raw);
  return parser.parse(raw);
}
