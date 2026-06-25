import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { extractFunctionCalls } from './functionCall.js';
import { parseJsonValueLoose, plainTextPlannerOutput, type ParsedPlannerOutput } from './plannerOutput.js';

const TOOL_CALLS_MARKER = '[TOOL_CALLS]';

/**
 * Mistral tool calls: a `[TOOL_CALLS]` marker followed by a JSON array of
 * `{name, arguments}` objects.
 *
 * ```
 * [TOOL_CALLS] [{"name": "get_weather", "arguments": {"city": "Tokyo"}}]
 * ```
 */
export const mistralSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'mistral-tool-calls',
  priority: 60,
  sniff: (text) => {
    const at = text.indexOf(TOOL_CALLS_MARKER);
    if (at < 0) return MatchKind.NoMatch;
    const payload = text.slice(at + TOOL_CALLS_MARKER.length);
    return extractFunctionCalls(parseJsonValueLoose(payload)).length > 0 ? MatchKind.Match : MatchKind.Incomplete;
  },
  parse: (text) => {
    const at = text.indexOf(TOOL_CALLS_MARKER);
    const toolRequests = extractFunctionCalls(parseJsonValueLoose(text.slice(at + TOOL_CALLS_MARKER.length)));
    if (toolRequests.length === 0) return plainTextPlannerOutput(text);
    return { assistantOutput: text.slice(0, at).trim(), toolRequests, followup: 'continue' };
  },
});
