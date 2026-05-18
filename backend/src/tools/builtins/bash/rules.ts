import { z } from 'zod';

export type BashToolRules = {
  allowed: 'always' | 'never' | 'ask';
  working_dir: string;
  max_timeout_ms: number;
  max_output_bytes: number;
};

const BashToolRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('ask'),
    working_dir: z.string().default(''),
    max_timeout_ms: z.number().finite().int().min(100).max(300000).default(60000),
    max_output_bytes: z.number().finite().int().min(1).max(10000000).default(100000),
  })
  .strict();

export function bashRulesSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      allowed: {
        type: 'string',
        enum: ['always', 'never', 'ask'],
        default: 'ask',
        description: "Permission behavior for this tool. 'always' auto-allows, 'never' blocks, 'ask' prompts the user.",
      },
      working_dir: {
        type: 'string',
        default: '',
        description: 'Default working directory for commands. Empty string means the process cwd.',
      },
      max_timeout_ms: {
        type: 'integer',
        minimum: 100,
        maximum: 300000,
        default: 60000,
        description: 'Hard cap on the timeout_ms param in milliseconds.',
      },
      max_output_bytes: {
        type: 'integer',
        minimum: 1,
        maximum: 10000000,
        default: 100000,
        description: 'Hard cap on combined stdout+stderr bytes returned.',
      },
    },
    required: ['allowed'],
  };
}

export function parseBashToolRules(raw: unknown): BashToolRules {
  const parsed = BashToolRulesSchema.parse(raw);
  return {
    allowed: parsed.allowed,
    working_dir: parsed.working_dir,
    max_timeout_ms: parsed.max_timeout_ms,
    max_output_bytes: parsed.max_output_bytes,
  };
}
