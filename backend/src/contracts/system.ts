import { z } from 'zod';

export type ToolCatalogItemResponse = {
  name: string;
  description?: string;
  ui?: boolean;
  [key: string]: unknown;
};

const ToolCatalogItemResponseSchema: z.ZodType<ToolCatalogItemResponse> = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    ui: z.boolean().optional(),
  })
  .passthrough();

export function validateGetToolsResponse(data: unknown): ToolCatalogItemResponse[] {
  const parsed = z.array(ToolCatalogItemResponseSchema).safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `GET /api/tools.${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`GET /api/tools validation failed: ${details}`);
  }
  return parsed.data;
}
