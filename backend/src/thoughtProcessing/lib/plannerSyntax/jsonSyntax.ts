import { defineSyntax, MatchKind } from '../../syntax/index.js';
import {
  parseJsonObjectLoose,
  plannerOutputFromJson,
  plainTextPlannerOutput,
  toolRequestsFromJson,
  type ParsedPlannerOutput,
} from './plannerOutput.js';

/** True once the first non-space char looks like the start of a JSON object or fence. */
function looksLikeJsonStart(text: string): boolean {
  return /^\s*(```|\{)/.test(text);
}

/**
 * The intended planner format: a JSON object with `assistant_output`,
 * `tool_requests`, and `followup`. A parsed object carrying tool requests is a
 * certain match (confidence 1); a well-formed object without them is weaker
 * (0.5) so a real tool-call dialect elsewhere in the text can win instead.
 */
export const jsonPlannerSyntax = defineSyntax<ParsedPlannerOutput>({
  name: 'json',
  priority: 100,
  sniff: (text) => {
    const obj = parseJsonObjectLoose(text);
    if (obj) {
      return { kind: MatchKind.Match, confidence: toolRequestsFromJson(obj).length > 0 ? 1 : 0.5 };
    }
    // Looks like JSON is starting but no balanced object yet → wait for more.
    return looksLikeJsonStart(text) ? MatchKind.Incomplete : MatchKind.NoMatch;
  },
  parse: (text) => {
    const obj = parseJsonObjectLoose(text);
    return obj ? plannerOutputFromJson(obj, text) : plainTextPlannerOutput(text);
  },
});
