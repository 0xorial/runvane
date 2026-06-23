import { z } from 'zod';

export const RagToolParamsSchema = z
  .object({
    query: z
      .string()
      .min(1)
      .describe('Natural-language query; retrieves the most semantically similar indexed chunks.'),
    top_k: z
      .number()
      .finite()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Max chunks to return (capped by the agent rule).'),
  })
  .strict();

export type RagToolParams = z.infer<typeof RagToolParamsSchema>;

export function ragToolParamsSchema(): unknown {
  return z.toJSONSchema(RagToolParamsSchema);
}

export function parseRagToolParams(raw: unknown): RagToolParams {
  return RagToolParamsSchema.parse(raw);
}
