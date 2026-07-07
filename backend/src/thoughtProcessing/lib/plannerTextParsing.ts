import { buildPlannerSyntaxRegistry, PLAINTEXT_SYNTAX_NAME } from './plannerSyntax/index.js';
import { plainTextPlannerOutput } from './plannerSyntax/plannerOutput.js';
import { argsToToolRequest } from './plannerSyntax/functionCall.js';
import { getCompletionText, getCompletionToolCalls } from '../../llmProviders/types.js';
import type { LlmCompletion } from '../../llmProviders/types.js';

// Back-compat re-exports: these helpers used to be defined here and are imported
// from this module elsewhere (notably plannerProvider's streaming mirror).
export {
  extractAssistantOutputFromJsonLike,
  extractAssistantPreviewFromStream,
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

/**
 * Parse a planner *completion*: the text dialects PLUS any native tool calls the
 * model emitted out-of-band as OpenAI-style `tool_calls` (captured as completion
 * `tool_call` parts, not in the text). Without this, a model that answers via
 * native function-calling — empty text content + `finish_reason: "tool_calls"` —
 * has its tool calls silently dropped and nothing executes.
 */
export function parsePlannerCompletion(
  completion: LlmCompletion,
  onJsonParseFailed?: (reply: string) => void,
): ParsedPlannerOutput {
  const native = getCompletionToolCalls(completion).map((call) => ({
    toolName: call.toolName,
    toolRequest: argsToToolRequest(call.args),
  }));
  // Empty/plaintext content is expected when the model answers via native tool
  // calls, so don't raise the "parse failed" diagnostic in that case.
  const fromText = parsePlannerOutput(getCompletionText(completion), native.length > 0 ? undefined : onJsonParseFailed);
  if (native.length === 0) return fromText;
  // A model that uses native function-calling puts its calls THERE; calls also
  // written into the text protocol are the same intent narrated twice (glm
  // does this). Concatenating both channels fans out duplicate members — and
  // duplicate executions once params resolve — so the structured channel wins.
  return {
    assistantOutput: fromText.assistantOutput,
    toolRequests: native,
    followup: 'continue',
  };
}
