import { z } from 'zod';

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export const CurlToolParamsSchema = z
  .object({
    url: z.string().min(1).describe('Absolute URL to request (http/https).'),
    method: z.enum(ALLOWED_METHODS).default('GET'),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().optional().describe('Optional request body for POST/PUT/PATCH/DELETE.'),
    timeoutMs: z.number().finite().int().min(100).max(60000).default(10000),
    maxResponseBytes: z.number().finite().int().min(256).max(1000000).default(50000),
    followRedirects: z.boolean().default(true),
  })
  .strict();

export type CurlToolParams = z.infer<typeof CurlToolParamsSchema>;

/** JSON Schema for the LLM, derived from the Zod schema — single source of truth. */
export function curlParamsSchema(): unknown {
  return z.toJSONSchema(CurlToolParamsSchema);
}

export function parseCurlToolParams(raw: unknown): CurlToolParams {
  return CurlToolParamsSchema.parse(raw);
}
