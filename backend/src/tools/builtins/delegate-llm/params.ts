import { z } from 'zod';

const DelegateLlmParamsSchema = z
  .object({
    provider_id: z.string().min(1),
    model_name: z.string().min(1),
    prompt: z.string().min(1),
    system_prompt: z.string().optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        }),
      )
      .optional(),
  })
  .strict();

export type DelegateLlmParams = {
  provider_id: string;
  model_name: string;
  prompt: string;
  system_prompt?: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
};

export function delegateLlmParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      provider_id: {
        type: 'string',
        description: 'The ID of the configured LLM provider to call (e.g. "openai", "openrouter", "lmstudio").',
      },
      model_name: {
        type: 'string',
        description: 'The model name to use with the provider (e.g. "gpt-4o", "mistral-7b").',
      },
      prompt: {
        type: 'string',
        description: 'The user prompt to send to the model.',
      },
      system_prompt: {
        type: 'string',
        description: 'Optional system instruction prepended to the conversation.',
      },
      messages: {
        type: 'array',
        description: 'Optional prior conversation context, appended before the prompt.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' },
          },
          required: ['role', 'content'],
        },
      },
    },
    required: ['provider_id', 'model_name', 'prompt'],
  };
}

export function parseDelegateLlmParams(raw: unknown): DelegateLlmParams {
  const parsed = DelegateLlmParamsSchema.parse(raw);
  const out: DelegateLlmParams = {
    provider_id: parsed.provider_id,
    model_name: parsed.model_name,
    prompt: parsed.prompt,
  };
  if (typeof parsed.system_prompt === 'string') out.system_prompt = parsed.system_prompt;
  if (parsed.messages) out.messages = parsed.messages;
  return out;
}
