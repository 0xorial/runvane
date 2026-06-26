import { z } from 'zod';

export const BashToolRulesSchema = z
  .object({
    working_dir: z
      .string()
      .default('')
      .describe('Default working directory for commands. Empty string means the process cwd.'),
    max_timeout_ms: z
      .number()
      .finite()
      .int()
      .min(100)
      .max(300000)
      .default(60000)
      .describe('Hard cap on the timeout_ms param in milliseconds.'),
    max_output_bytes: z
      .number()
      .finite()
      .int()
      .min(1)
      .max(10000000)
      .default(20000)
      .describe('Hard cap on combined stdout+stderr bytes returned (keep modest — this output lands in the model context).'),
  })
  .strict();

export type BashToolRules = z.infer<typeof BashToolRulesSchema>;

export function parseBashToolRules(raw: unknown): BashToolRules {
  return BashToolRulesSchema.parse(raw);
}
