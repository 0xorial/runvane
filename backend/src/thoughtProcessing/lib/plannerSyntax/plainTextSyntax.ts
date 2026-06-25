import { defineSyntax, MatchKind } from '../../syntax/index.js';
import { plainTextPlannerOutput, type ParsedPlannerOutput } from './plannerOutput.js';

/** Stable name of the catch-all syntax; callers use it to detect "no structure found". */
export const PLAINTEXT_SYNTAX_NAME = 'plaintext';

/**
 * Catch-all. Always matches at near-zero confidence so any real dialect beats it,
 * but it guarantees the selector always resolves to *something* — the reply is
 * surfaced as plain assistant prose with no tool calls.
 */
export const plainTextPlannerSyntax = defineSyntax<ParsedPlannerOutput>({
  name: PLAINTEXT_SYNTAX_NAME,
  priority: -100,
  sniff: () => ({ kind: MatchKind.Match, confidence: 0.01 }),
  parse: plainTextPlannerOutput,
});
