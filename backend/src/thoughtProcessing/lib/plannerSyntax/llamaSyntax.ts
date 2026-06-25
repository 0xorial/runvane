import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { extractFunctionCalls } from './functionCall.js';
import { parseJsonValueLoose, plainTextPlannerOutput, type ParsedPlannerOutput } from './plannerOutput.js';

const PYTHON_TAG = '<|python_tag|>';
const EOM = '<|eom_id|>';

/**
 * Llama 3.1 tool calls in code-interpreter style: a `<|python_tag|>` prefix, a
 * JSON call object using `name`/`parameters`, optionally terminated by
 * `<|eom_id|>`.
 *
 * ```
 * <|python_tag|>{"name": "get_weather", "parameters": {"city": "Tokyo"}}<|eom_id|>
 * ```
 */
export const llamaSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'llama-python-tag',
  priority: 60,
  sniff: (text) => {
    const at = text.indexOf(PYTHON_TAG);
    if (at < 0) return MatchKind.NoMatch;
    return extractFunctionCalls(parseJsonValueLoose(payloadAfterTag(text, at))).length > 0
      ? MatchKind.Match
      : MatchKind.Incomplete;
  },
  parse: (text) => {
    const at = text.indexOf(PYTHON_TAG);
    const toolRequests = extractFunctionCalls(parseJsonValueLoose(payloadAfterTag(text, at)));
    if (toolRequests.length === 0) return plainTextPlannerOutput(text);
    return { assistantOutput: text.slice(0, at).trim(), toolRequests, followup: 'continue' };
  },
});

/** Text between the python tag and the end-of-message marker (or end of text). */
function payloadAfterTag(text: string, at: number): string {
  const rest = text.slice(at + PYTHON_TAG.length);
  const eom = rest.indexOf(EOM);
  return eom < 0 ? rest : rest.slice(0, eom);
}
