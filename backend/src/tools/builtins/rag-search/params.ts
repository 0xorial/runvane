import { z } from 'zod';

export const RagSearchParamsSchema = z
  .object({
    query: z.string().min(1).describe('Case-insensitive substring to find in text files under allowed roots.'),
    path_prefix: z
      .string()
      .min(1)
      .optional()
      .describe('Optional absolute path prefix to limit the search scope.'),
    max_results: z.number().finite().int().min(1).max(100).optional(),
  })
  .strict();

export type RagSearchParams = z.infer<typeof RagSearchParamsSchema>;

export function ragSearchParamsSchema(): unknown {
  return z.toJSONSchema(RagSearchParamsSchema);
}

export function parseRagSearchParams(raw: unknown): RagSearchParams {
  return RagSearchParamsSchema.parse(raw);
}
