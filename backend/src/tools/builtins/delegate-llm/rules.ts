import { z } from 'zod';

export type DelegateLlmRules = {
  allowed: 'always' | 'never' | 'ask';
  allowed_provider_ids: string[];
  max_prompt_chars: number;
  max_response_chars: number;
};

const DelegateLlmRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('always'),
    allowed_provider_ids: z.array(z.string().min(1)).default([]),
    max_prompt_chars: z.number().finite().int().min(1).default(50000),
    max_response_chars: z.number().finite().int().min(1).default(20000),
  })
  .strict();

export function delegateLlmRulesSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      allowed: {
        type: 'string',
        enum: ['always', 'never', 'ask'],
        default: 'always',
        description: 'Permission behavior for this tool.',
      },
      allowed_provider_ids: {
        type: 'array',
        items: { type: 'string' },
        default: [],
        description: 'Allowlist of provider IDs. Empty means all configured providers are allowed.',
      },
      max_prompt_chars: {
        type: 'integer',
        minimum: 1,
        default: 50000,
        description: 'Maximum number of characters allowed in the prompt before truncation.',
      },
      max_response_chars: {
        type: 'integer',
        minimum: 1,
        default: 20000,
        description: 'Maximum number of characters returned from the LLM response.',
      },
    },
    required: ['allowed'],
  };
}

export function parseDelegateLlmRules(raw: unknown): DelegateLlmRules {
  const parsed = DelegateLlmRulesSchema.parse(raw);
  return {
    allowed: parsed.allowed,
    allowed_provider_ids: parsed.allowed_provider_ids,
    max_prompt_chars: parsed.max_prompt_chars,
    max_response_chars: parsed.max_response_chars,
  };
}
