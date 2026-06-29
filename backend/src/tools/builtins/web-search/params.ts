import { z } from 'zod';

export const WebSearchParamsSchema = z
  .object({
    query: z.string().min(1).describe('The search query.'),
    count: z
      .number()
      .finite()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Maximum number of results to return.'),
  })
  .strict();

export type WebSearchParams = z.infer<typeof WebSearchParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function webSearchParamsSchema(): unknown {
  return z.toJSONSchema(WebSearchParamsSchema);
}

export function parseWebSearchParams(raw: unknown): WebSearchParams {
  return WebSearchParamsSchema.parse(raw);
}
