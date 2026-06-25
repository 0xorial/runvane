import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { plainTextPlannerOutput, type ParsedPlannerOutput } from './plannerOutput.js';

const TOOL_CALL_BLOCK = /<tool_call\b([^>]*)>([\s\S]*?)<\/tool_call>/gi;
const NAME_ATTR = /\bname\s*=\s*["']([^"']+)["']/i;
const TOOL_NAME_TAG = /<tool_name>([\s\S]*?)<\/tool_name>/i;
const TOOL_REQUEST_TAG = /<tool_request>([\s\S]*?)<\/tool_request>/i;
const ASSISTANT_OUTPUT_TAG = /<assistant_output>([\s\S]*?)<\/assistant_output>/i;

/**
 * XML-ish tool calls — the format models reach for when they "forget" JSON:
 *
 * ```xml
 * <assistant_output>On it.</assistant_output>
 * <tool_call name="get_current_time">now</tool_call>
 * <tool_call><tool_name>search</tool_name><tool_request>cats</tool_request></tool_call>
 * ```
 *
 * Both the `name="..."` attribute form and nested `<tool_name>`/`<tool_request>`
 * children are supported. A closed `<tool_call>` is a certain match (confidence
 * 1); an opened one with no close is Incomplete.
 */
export const xmlPlannerSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'xml-tags',
  priority: 60,
  sniff: (text) => {
    if (!/<tool_call[\s>]/i.test(text)) return MatchKind.NoMatch;
    return /<\/tool_call>/i.test(text) ? MatchKind.Match : MatchKind.Incomplete;
  },
  parse: (text) => {
    const toolRequests: ParsedPlannerOutput['toolRequests'] = [];
    for (const block of text.matchAll(TOOL_CALL_BLOCK)) {
      const attrs = block[1] ?? '';
      const inner = block[2] ?? '';
      const toolName = (NAME_ATTR.exec(attrs)?.[1] ?? TOOL_NAME_TAG.exec(inner)?.[1] ?? '').trim();
      if (!toolName) continue;
      const requestTag = TOOL_REQUEST_TAG.exec(inner)?.[1];
      const toolRequest = (requestTag ?? inner).trim();
      toolRequests.push({ toolName, toolRequest });
    }
    if (toolRequests.length === 0) return plainTextPlannerOutput(text);

    const assistantOutput = (
      ASSISTANT_OUTPUT_TAG.exec(text)?.[1] ?? text.replace(TOOL_CALL_BLOCK, '')
    ).trim();
    return { assistantOutput, toolRequests, followup: 'continue' };
  },
});
