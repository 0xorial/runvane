import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { argsToToolRequest, extractFunctionCalls } from './functionCall.js';
import { parseJsonValueLoose, plainTextPlannerOutput, type ParsedPlannerOutput } from './plannerOutput.js';

const TOOL_CALL_BLOCK = /<tool_call\b([^>]*)>([\s\S]*?)<\/tool_call>/gi;
const NAME_ATTR = /\bname\s*=\s*["']([^"']+)["']/i;
const TOOL_NAME_TAG = /<tool_name>([\s\S]*?)<\/tool_name>/i;
const TOOL_REQUEST_TAG = /<tool_request>([\s\S]*?)<\/tool_request>/i;
const ASSISTANT_OUTPUT_TAG = /<assistant_output>([\s\S]*?)<\/assistant_output>/i;

/** Parse one `<tool_call>` block body into zero or more tool requests. */
function parseBlock(attrs: string, inner: string): ParsedPlannerOutput['toolRequests'] {
  const body = inner.trim();
  // Hermes / Qwen: a JSON object or array inside the tags.
  if (body.startsWith('{') || body.startsWith('[')) {
    const calls = extractFunctionCalls(parseJsonValueLoose(body));
    if (calls.length > 0) return calls;
  }
  // Attribute form (`name="…"`) or nested `<tool_name>` child.
  const toolName = (NAME_ATTR.exec(attrs)?.[1] ?? TOOL_NAME_TAG.exec(inner)?.[1] ?? '').trim();
  if (!toolName) return [];
  const toolRequest = (TOOL_REQUEST_TAG.exec(inner)?.[1] ?? body).trim();
  return [{ toolName, toolRequest: argsToToolRequest(toolRequest) }];
}

/**
 * The `<tool_call>…</tool_call>` tag dialect — the most common way models frame
 * tool calls outside native JSON, used by Qwen, Hermes-2/3 and many others:
 *
 * ```xml
 * <tool_call>{"name": "search", "arguments": {"q": "cats"}}</tool_call>
 * <tool_call name="get_time">now</tool_call>
 * <tool_call><tool_name>search</tool_name><tool_request>cats</tool_request></tool_call>
 * ```
 *
 * A closed `<tool_call>` is a certain match (confidence 1); an open one with no
 * close is Incomplete.
 */
export const toolCallTagsSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'tool-call-tags',
  priority: 60,
  sniff: (text) => {
    if (!/<tool_call[\s>]/i.test(text)) return MatchKind.NoMatch;
    return /<\/tool_call>/i.test(text) ? MatchKind.Match : MatchKind.Incomplete;
  },
  parse: (text) => {
    const toolRequests: ParsedPlannerOutput['toolRequests'] = [];
    for (const block of text.matchAll(TOOL_CALL_BLOCK)) {
      toolRequests.push(...parseBlock(block[1] ?? '', block[2] ?? ''));
    }
    if (toolRequests.length === 0) return plainTextPlannerOutput(text);

    const assistantOutput = (ASSISTANT_OUTPUT_TAG.exec(text)?.[1] ?? text.replace(TOOL_CALL_BLOCK, '')).trim();
    return { assistantOutput, toolRequests, followup: 'continue' };
  },
});
