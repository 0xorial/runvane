import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { extractFunctionCalls } from './functionCall.js';
import {
  extractAssistantOutputFromJsonLike,
  parseJsonValueStrict,
  type ParsedPlannerOutput,
} from './plannerOutput.js';

/**
 * Bare function-call JSON — what most models emit when prompted for tools
 * without our planner envelope:
 *
 * ```json
 * {"name": "get_weather", "arguments": {"city": "Tokyo"}}
 * [{"name": "a", "arguments": {}}, {"name": "b", "parameters": {}}]
 * {"tool_calls": [{"function": {"name": "a", "arguments": "{}"}}]}
 * ```
 *
 * Certain (confidence 1) once a call is found, so it outranks the planner JSON
 * provider's 0.5 for a no-`tool_requests` object. Priority sits just below the
 * planner schema so a native `tool_requests` reply still wins on its own merits.
 *
 * Matches only when the whole message is this JSON (strict parse), so a payload
 * carried after another dialect's marker — `[TOOL_CALLS] […]`, `<|python_tag|>…`
 * — is left to that dialect. The planner JSON provider's Incomplete already
 * covers waiting on a partially-streamed object.
 */
export const functionCallJsonSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'function-call-json',
  priority: 90,
  sniff: (text) => {
    const value = parseJsonValueStrict(text);
    return value !== undefined && extractFunctionCalls(value).length > 0 ? MatchKind.Match : MatchKind.NoMatch;
  },
  parse: (text) => {
    const toolRequests = extractFunctionCalls(parseJsonValueStrict(text));
    return {
      assistantOutput: extractAssistantOutputFromJsonLike(text),
      toolRequests,
      followup: toolRequests.length > 0 ? 'continue' : 'finalize',
    };
  },
});
