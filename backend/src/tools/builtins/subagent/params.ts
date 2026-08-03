import { z } from 'zod';

export const RunSubagentParamsSchema = z
  .object({
    prompt: z
      .string()
      .min(1)
      .describe(
        'Self-contained brief for the subagent. It starts with a FRESH context — no access to this ' +
          'conversation — so include every fact, path, and constraint it needs, and say what to return.',
      ),
    title: z.string().optional().describe('Title for the subagent conversation shown in the sidebar.'),
    agent_id: z
      .string()
      .optional()
      .describe('Agent to run the subagent as. Defaults to the calling agent; others need allow_other_agents.'),
  })
  .strict();

export type RunSubagentParams = z.infer<typeof RunSubagentParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function runSubagentParamsSchema(): unknown {
  return z.toJSONSchema(RunSubagentParamsSchema);
}

export function parseRunSubagentParams(raw: unknown): RunSubagentParams {
  return RunSubagentParamsSchema.parse(raw);
}
