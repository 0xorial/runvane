import { defineSyntax, MatchKind } from '../../syntax/index.js';
import {
  gemmaArgsToToolRequest,
  parseGemma4ToolCalls,
  stripGemmaToolCallBlocks,
} from '../gemma4ToolCallParsing.js';
import {
  extractAssistantOutputFromJsonLike,
  parseJsonObjectLoose,
  plainTextPlannerOutput,
  type ParsedPlannerOutput,
} from './plannerOutput.js';

const GEMMA_OPEN_TOKEN = '<|tool_call>';

/**
 * Gemma-family models emit tool calls as `<|tool_call>call:name{...}<tool_call|>`
 * blocks instead of JSON. A parsed block is a certain match (confidence 1) and
 * outranks a JSON object that lacks tool requests (0.5); JSON tool requests still
 * win on a tie through higher priority. An opened block with no closing token
 * reports Incomplete so a streamed call isn't parsed early.
 */
export const gemmaPlannerSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'gemma-tool-call',
  priority: 70,
  sniff: (text) => {
    if (!text.includes(GEMMA_OPEN_TOKEN)) return MatchKind.NoMatch;
    return parseGemma4ToolCalls(text).length > 0 ? MatchKind.Match : MatchKind.Incomplete;
  },
  parse: (text) => {
    const toolRequests = parseGemma4ToolCalls(text)
      .map((call) => ({ toolName: call.toolName, toolRequest: gemmaArgsToToolRequest(call.args) }))
      .filter((row) => row.toolName.length > 0);
    if (toolRequests.length === 0) return plainTextPlannerOutput(text);

    // Prefer a JSON assistant_output if the reply mixed both; else the prose
    // that precedes the tool-call blocks.
    const obj = parseJsonObjectLoose(text);
    const assistantOutput =
      (obj && typeof obj.assistant_output === 'string' ? obj.assistant_output : '') ||
      extractAssistantOutputFromJsonLike(text) ||
      stripGemmaToolCallBlocks(text);
    return { assistantOutput, toolRequests, followup: 'continue' };
  },
});
