import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { argsToToolRequest } from './functionCall.js';
import { plainTextPlannerOutput, type ParsedPlannerOutput } from './plannerOutput.js';

const OPEN = /<function_calls>|<invoke\b/i;
const INVOKE_BLOCK = /<invoke\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/invoke>/gi;
const PARAM = /<parameter\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/parameter>/gi;

/**
 * Anthropic / Claude XML tool calls: a `<function_calls>` block of `<invoke>`s,
 * each carrying `<parameter name="…">value</parameter>` children.
 *
 * ```xml
 * <function_calls>
 * <invoke name="get_weather">
 * <parameter name="location">Tokyo</parameter>
 * </invoke>
 * </function_calls>
 * ```
 *
 * Parameters are collected into an object; a closed `</invoke>` is a certain
 * match, an open one is Incomplete.
 */
export const anthropicInvokeSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'anthropic-invoke',
  priority: 60,
  sniff: (text) => {
    if (!OPEN.test(text)) return MatchKind.NoMatch;
    return /<\/invoke>/i.test(text) ? MatchKind.Match : MatchKind.Incomplete;
  },
  parse: (text) => {
    const toolRequests: ParsedPlannerOutput['toolRequests'] = [];
    for (const invoke of text.matchAll(INVOKE_BLOCK)) {
      const toolName = (invoke[1] ?? '').trim();
      if (!toolName) continue;
      const params: Record<string, string> = {};
      for (const param of (invoke[2] ?? '').matchAll(PARAM)) params[param[1].trim()] = (param[2] ?? '').trim();
      const toolRequest = Object.keys(params).length > 0 ? argsToToolRequest(params) : '';
      toolRequests.push({ toolName, toolRequest });
    }
    if (toolRequests.length === 0) return plainTextPlannerOutput(text);

    const open = text.search(OPEN);
    return { assistantOutput: (open > 0 ? text.slice(0, open) : '').trim(), toolRequests, followup: 'continue' };
  },
});
