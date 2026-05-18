import { z } from 'zod';

const BashToolParamsSchema = z
  .object({
    command: z.string().min(1),
    working_dir: z.string().optional(),
    timeout_ms: z.number().finite().int().min(100).optional(),
    max_output_bytes: z.number().finite().int().min(1).optional(),
  })
  .strict();

export type BashToolParams = {
  command: string;
  working_dir?: string;
  timeout_ms?: number;
  max_output_bytes?: number;
};

export function bashParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to run (executed via /bin/bash -c).',
      },
      working_dir: {
        type: 'string',
        description: 'Absolute path to use as the working directory. Overrides the rule default.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 100,
        description: 'Timeout in milliseconds. Capped by the max_timeout_ms rule.',
      },
      max_output_bytes: {
        type: 'integer',
        minimum: 1,
        description: 'Max combined stdout+stderr bytes to return. Capped by the max_output_bytes rule.',
      },
    },
    required: ['command'],
  };
}

export function parseBashToolParams(raw: unknown): BashToolParams {
  const parsed = BashToolParamsSchema.parse(raw);
  const out: BashToolParams = { command: parsed.command };
  if (parsed.working_dir !== undefined) out.working_dir = parsed.working_dir;
  if (parsed.timeout_ms !== undefined) out.timeout_ms = parsed.timeout_ms;
  if (parsed.max_output_bytes !== undefined) out.max_output_bytes = parsed.max_output_bytes;
  return out;
}
