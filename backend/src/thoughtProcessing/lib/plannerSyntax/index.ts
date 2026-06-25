/**
 * Planner syntax dialects, assembled into a {@link SyntaxRegistry}.
 *
 * Supporting another markup the models drift into is a two-line change: write a
 * `defineSyntax` provider in this folder and add it to the `register(...)` call
 * below. Nothing in `plannerProvider` or the parsing call site changes.
 */
import { SyntaxRegistry } from '../../syntax/index.js';
import type { ParsedPlannerOutput } from './plannerOutput.js';
import { jsonPlannerSyntax } from './jsonSyntax.js';
import { functionCallJsonSyntax } from './functionCallJsonSyntax.js';
import { gemmaPlannerSyntax } from './gemmaSyntax.js';
import { toolCallTagsSyntax } from './toolCallTagsSyntax.js';
import { mistralSyntax } from './mistralSyntax.js';
import { llamaSyntax } from './llamaSyntax.js';
import { deepseekSyntax } from './deepseekSyntax.js';
import { plainTextPlannerSyntax } from './plainTextSyntax.js';

export { PLAINTEXT_SYNTAX_NAME } from './plainTextSyntax.js';
export {
  jsonPlannerSyntax,
  functionCallJsonSyntax,
  gemmaPlannerSyntax,
  toolCallTagsSyntax,
  mistralSyntax,
  llamaSyntax,
  deepseekSyntax,
  plainTextPlannerSyntax,
};

/**
 * Build a registry over all planner dialects. Order in `register` is irrelevant
 * (the registry sorts by priority). A complete tool-call structure is a certain
 * match (confidence 1) and wins over a JSON object with no tool requests (0.5),
 * which in turn beats the plaintext catch-all (0.01). When several dialects are
 * equally certain, higher priority decides: planner JSON (100) > bare
 * function-call JSON (90) > Gemma (70) > tag/Mistral/Llama dialects (60).
 */
export function buildPlannerSyntaxRegistry(): SyntaxRegistry<ParsedPlannerOutput> {
  return new SyntaxRegistry<ParsedPlannerOutput>().register(
    jsonPlannerSyntax,
    functionCallJsonSyntax,
    gemmaPlannerSyntax,
    toolCallTagsSyntax,
    mistralSyntax,
    llamaSyntax,
    deepseekSyntax,
    plainTextPlannerSyntax,
  );
}
