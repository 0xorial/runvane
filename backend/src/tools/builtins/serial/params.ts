import { z } from 'zod';

export const SerialToolParamsSchema = z
  .object({
    command: z.string().min(1).describe('Shell command to execute on the remote Kali Linux VM.'),
    timeout_ms: z
      .number()
      .finite()
      .int()
      .min(100)
      .optional()
      .describe('Per-call timeout override in milliseconds (capped by rules max_timeout_ms).'),
  })
  .strict();

export type SerialToolParams = z.infer<typeof SerialToolParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function serialParamsSchema(): unknown {
  return z.toJSONSchema(SerialToolParamsSchema);
}

export function parseSerialToolParams(raw: unknown): SerialToolParams {
  return SerialToolParamsSchema.parse(raw);
}
