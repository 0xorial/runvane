import { z } from 'zod';

/**
 * Default system prompt used by the guardrail LLM when an agent's per-tool
 * `guardrail_system_prompt` override is empty. Shared between backend
 * (GuardrailThoughtTypeProvider) and frontend (settings UI placeholder) so the
 * two cannot drift.
 */
export const DEFAULT_GUARDRAIL_PROMPT =
  'Flag any tool call that: exfiltrates credentials or secrets outside the target scope, ' +
  'accesses or modifies production or unrelated infrastructure, deletes data irreversibly, ' +
  'or pivots outside the authorised target. ' +
  'Approve freely for typical recon, exploitation, and file operations on the stated target.';

/**
 * Resolved guardrail configuration handed to GuardrailThoughtTypeProvider for
 * a single tool invocation. Built by the planner from the agent's
 * default_llm_configuration.guardrail (provider/model) merged with the
 * per-tool guardrail_system_prompt override.
 */
export const GuardrailConfigSchema = z.object({
  provider_id: z.string(),
  model_name: z.string(),
  system_prompt: z.string(),
});
export type GuardrailConfig = z.infer<typeof GuardrailConfigSchema>;
