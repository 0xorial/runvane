import { z } from 'zod';

export const RunSubagentRulesSchema = z
  .object({
    allow_other_agents: z
      .boolean()
      .default(false)
      .describe(
        'Allow spawning a subagent as a DIFFERENT agent than the caller. Off by default: another agent ' +
          'may have looser tool policies than this one.',
      ),
    max_depth: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1)
      .describe(
        'How deep subagent chains may nest. 1 (default) means a subagent cannot spawn subagents of its own.',
      ),
    timeout_ms: z
      .number()
      .finite()
      .int()
      .min(1000)
      .max(3_600_000)
      .default(300_000)
      .describe('Maximum time to wait for the subagent run before cancelling it.'),
    max_response_chars: z
      .number()
      .finite()
      .int()
      .min(1)
      .default(20000)
      .describe('Maximum number of characters returned from the subagent final answer.'),
  })
  .strict();

export type RunSubagentRules = z.infer<typeof RunSubagentRulesSchema>;

export function parseRunSubagentRules(raw: unknown): RunSubagentRules {
  return RunSubagentRulesSchema.parse(raw);
}
