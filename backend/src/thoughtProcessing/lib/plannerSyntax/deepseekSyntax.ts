import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { argsToToolRequest, extractFunctionCalls } from './functionCall.js';
import {
  extractLastBalancedJsonObject,
  parseJsonValueLoose,
  plainTextPlannerOutput,
  type ParsedPlannerOutput,
} from './plannerOutput.js';

// DeepSeek tool-call tokens use a fullwidth vertical bar (U+FF5C) and U+2581
// (the in-token word separator), kept as literal UTF-8 glyphs below.
const BAR = '｜'; // ｜ fullwidth vertical bar
const SEP = '▁'; // ▁ in-token word separator
const CALL_BEGIN = `<${BAR}tool${SEP}call${SEP}begin${BAR}>`;
const CALL_END = `<${BAR}tool${SEP}call${SEP}end${BAR}>`;
const CALLS_END = `<${BAR}tool${SEP}calls${SEP}end${BAR}>`;
const TOOL_SEP = `<${BAR}tool${SEP}sep${BAR}>`;

// Matches the canonical `<｜tool▁calls▁begin｜>` opener and the user's literal
// `<｜｜DSML｜｜tool_calls>` variant: a fullwidth-bar token containing "tool_calls".
const OPENER = new RegExp(`<${BAR}[^<>]*tool[${SEP}_]calls[^<>]*>`, 'i');
const ARGS_FENCE = /```(?:json)?\s*([\s\S]*?)```/i;

type DeepseekCall = { toolName: string; toolRequest: string; complete: boolean };

/** Parse one `<｜tool▁call▁begin｜>…` segment: name after the sep, args from the fence. */
function parseSegment(seg: string): DeepseekCall | null {
  const sepAt = seg.indexOf(TOOL_SEP);
  const after = sepAt >= 0 ? seg.slice(sepAt + TOOL_SEP.length) : seg;
  let toolName = (/^\s*([^\n`{]+?)\s*(?:\n|```|\{|$)/.exec(after)?.[1] ?? '').trim();
  if (sepAt < 0) toolName = toolName.replace(/^(?:function|tool)\s+/i, '').trim(); // drop a leading type word
  if (!toolName) return null;

  let argsRaw = '';
  const fence = ARGS_FENCE.exec(after);
  if (fence) {
    argsRaw = fence[1].trim();
  } else if (after.includes('```')) {
    return { toolName, toolRequest: '', complete: false }; // args fence opened, still streaming
  } else {
    const obj = extractLastBalancedJsonObject(after);
    if (obj) argsRaw = obj.trim();
    else if (/[{[]/.test(after)) return { toolName, toolRequest: '', complete: false }; // JSON started, unbalanced
  }
  if (!argsRaw) return { toolName, toolRequest: '', complete: true }; // a call that takes no args
  const parsed = parseJsonValueLoose(argsRaw);
  return parsed === undefined
    ? { toolName, toolRequest: argsRaw, complete: false } // args still streaming
    : { toolName, toolRequest: argsToToolRequest(parsed), complete: true };
}

/** Extract all tool calls following the opener (`[]` if there is no opener). */
function extractCalls(text: string): DeepseekCall[] {
  const opener = OPENER.exec(text);
  if (!opener) return [];
  const body = text.slice(opener.index + opener[0].length);

  if (body.includes(CALL_BEGIN)) {
    return body
      .split(CALL_BEGIN)
      .slice(1)
      .map((part) => parseSegment(part.split(CALL_END)[0].split(CALLS_END)[0]))
      .filter((call): call is DeepseekCall => call !== null);
  }
  // Tolerant fallback: a DSML opener wrapping a bare JSON array/object of calls.
  const region = body.includes(CALLS_END) ? body.slice(0, body.indexOf(CALLS_END)) : body;
  return extractFunctionCalls(parseJsonValueLoose(region)).map((call) => ({ ...call, complete: true }));
}

/**
 * DeepSeek V3 / R1 tool calls:
 *
 * ```
 * <｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>get_weather
 * ```json
 * {"city": "Tokyo"}
 * ```<｜tool▁call▁end｜><｜tool▁calls▁end｜>
 * ```
 *
 * The opener detector is tolerant: it also fires on the literal
 * `<｜｜DSML｜｜tool_calls>` opener. Incomplete until at least one call has a fully
 * parsed args object, so a streamed call isn't committed early.
 */
export const deepseekSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'deepseek',
  priority: 60,
  sniff: (text) => {
    if (!OPENER.test(text)) return MatchKind.NoMatch;
    const calls = extractCalls(text);
    return calls.length > 0 && calls.every((call) => call.complete) ? MatchKind.Match : MatchKind.Incomplete;
  },
  parse: (text) => {
    const opener = OPENER.exec(text);
    if (!opener) return plainTextPlannerOutput(text);
    const toolRequests = extractCalls(text).map(({ toolName, toolRequest }) => ({ toolName, toolRequest }));
    if (toolRequests.length === 0) return plainTextPlannerOutput(text);
    return { assistantOutput: text.slice(0, opener.index).trim(), toolRequests, followup: 'continue' };
  },
});
