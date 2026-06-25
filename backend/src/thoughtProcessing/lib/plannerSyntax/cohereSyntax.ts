import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { extractFunctionCalls } from './functionCall.js';
import { parseJsonValueLoose, plainTextPlannerOutput, type ParsedPlannerOutput } from './plannerOutput.js';

const MARKER = 'Action:';
// Gate: an `Action:` immediately followed (modulo a ```json fence) by a JSON
// array/object — distinguishes a real tool block from the word in prose.
const ACTION_GATE = /Action:\s*(?:```(?:json)?\s*)?[[{]/i;

/**
 * Cohere Command-R / R+ tool calls: an `Action:` marker followed by a fenced
 * JSON array of `{tool_name, parameters}` objects.
 *
 * ```
 * Action: ```json
 * [{"tool_name": "web_search", "parameters": {"query": "penguins"}}]
 * ```
 * ```
 */
export const cohereSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'cohere-command-r',
  priority: 60,
  sniff: (text) => {
    if (!ACTION_GATE.test(text)) return MatchKind.NoMatch;
    const after = text.slice(text.indexOf(MARKER) + MARKER.length);
    return extractFunctionCalls(parseJsonValueLoose(after)).length > 0 ? MatchKind.Match : MatchKind.Incomplete;
  },
  parse: (text) => {
    const at = text.indexOf(MARKER);
    const toolRequests = extractFunctionCalls(parseJsonValueLoose(text.slice(at + MARKER.length)));
    if (toolRequests.length === 0) return plainTextPlannerOutput(text);
    return { assistantOutput: text.slice(0, at).trim(), toolRequests, followup: 'continue' };
  },
});
