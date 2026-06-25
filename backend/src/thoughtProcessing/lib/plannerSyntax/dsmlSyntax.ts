import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { gemmaArgsToToolRequest } from '../gemma4ToolCallParsing.js';
import { plainTextPlannerOutput, type ParsedPlannerOutput } from './plannerOutput.js';

const BAR = '｜'; // U+FF5C — the fullwidth bar DSML decorates its tag names with

// Tolerant to <｜DSML｜tag>, <｜｜DSML｜｜tag>, etc. — any fullwidth-bar-decorated tag.
const OPEN = new RegExp(`<${BAR}[^<>]*(?:tool_calls|invoke)`, 'i');
const CLOSED_INVOKE = new RegExp(`</${BAR}[^<>]*invoke>`, 'i');
const INVOKE = new RegExp(`<${BAR}[^<>]*invoke\\b[^>]*\\bname="([^"]+)"[^>]*>([\\s\\S]*?)</${BAR}[^<>]*invoke>`, 'gi');
const PARAM = new RegExp(`<${BAR}[^<>]*parameter\\b[^>]*\\bname="([^"]+)"[^>]*>([\\s\\S]*?)</${BAR}[^<>]*parameter>`, 'gi');

/**
 * DSML tool calls: an Anthropic-style invoke/parameter XML whose tag names are
 * decorated with a fullwidth-bar prefix (`<｜DSML｜invoke>`):
 *
 * ```
 * <｜DSML｜tool_calls>
 *   <｜DSML｜invoke name="bash">
 *     <｜DSML｜parameter name="tool_request" string="true">…</｜DSML｜parameter>
 *     <｜DSML｜parameter name="source" string="true">planner_tool_request</｜DSML｜parameter>
 *   </｜DSML｜invoke>
 * </｜DSML｜tool_calls>
 * ```
 *
 * Parameters follow the planner convention (`tool_request` is the brief, `source`
 * is metadata), so the request is taken from `tool_request` via
 * {@link gemmaArgsToToolRequest}. A closed `</｜…invoke>` is a certain match; an
 * open one is Incomplete.
 */
export const dsmlSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'dsml',
  priority: 60,
  sniff: (text) => {
    if (!OPEN.test(text)) return MatchKind.NoMatch;
    return CLOSED_INVOKE.test(text) ? MatchKind.Match : MatchKind.Incomplete;
  },
  parse: (text) => {
    const toolRequests: ParsedPlannerOutput['toolRequests'] = [];
    for (const invoke of text.matchAll(INVOKE)) {
      const toolName = (invoke[1] ?? '').trim();
      if (!toolName) continue;
      const params: Record<string, string> = {};
      for (const param of (invoke[2] ?? '').matchAll(PARAM)) params[param[1].trim()] = (param[2] ?? '').trim();
      toolRequests.push({ toolName, toolRequest: gemmaArgsToToolRequest(params) });
    }
    if (toolRequests.length === 0) return plainTextPlannerOutput(text);

    const openerAt = OPEN.exec(text)?.index ?? -1;
    const assistantOutput = (openerAt > 0 ? text.slice(0, openerAt) : '').trim();
    return { assistantOutput, toolRequests, followup: 'continue' };
  },
});
