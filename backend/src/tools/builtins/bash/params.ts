import { z } from 'zod';

export const BashToolParamsSchema = z
  .object({
    command: z.string().min(1).describe('The shell command to run (executed via /bin/bash -c).'),
    working_dir: z
      .string()
      .optional()
      .describe('Absolute path to use as the working directory. Overrides the rule default.'),
    timeout_ms: z
      .number()
      .finite()
      .int()
      .min(100)
      .optional()
      .describe('Timeout in milliseconds. Capped by the max_timeout_ms rule.'),
    max_output_bytes: z
      .number()
      .finite()
      .int()
      .min(1)
      .optional()
      .describe('Max combined stdout+stderr bytes to return. Capped by the max_output_bytes rule.'),
  })
  .strict();

export type BashToolParams = z.infer<typeof BashToolParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function bashParamsSchema(): unknown {
  return z.toJSONSchema(BashToolParamsSchema);
}

export function parseBashToolParams(raw: unknown): BashToolParams {
  return BashToolParamsSchema.parse(raw);
}
