import { z } from 'zod';

const SerialToolParamsSchema = z
  .object({
    command: z.string().min(1),
    timeout_ms: z.number().finite().int().min(100).optional(),
  })
  .strict();

export type SerialToolParams = {
  command: string;
  timeout_ms?: number;
};

export function serialParamsSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute on the remote Kali Linux VM.',
      },
      timeout_ms: {
        type: 'integer',
        minimum: 100,
        description: 'Per-call timeout override in milliseconds (capped by rules max_timeout_ms).',
      },
    },
    required: ['command'],
  };
}

export function parseSerialToolParams(raw: unknown): SerialToolParams {
  const parsed = SerialToolParamsSchema.parse(raw);
  const out: SerialToolParams = { command: parsed.command };
  if (typeof parsed.timeout_ms === 'number') out.timeout_ms = parsed.timeout_ms;
  return out;
}
