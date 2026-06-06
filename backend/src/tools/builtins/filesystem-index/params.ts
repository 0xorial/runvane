import { z } from 'zod';

export const FilesystemIndexOperationSchema = z.enum(['refresh', 'search', 'stats']);

export const FilesystemIndexParamsSchema = z
  .object({
    operation: FilesystemIndexOperationSchema,
    pattern: z.string().min(1).optional().describe('Substring match on relative paths (search only).'),
    max_results: z.number().finite().int().min(1).max(500).optional(),
  })
  .strict();

export type FilesystemIndexParams = z.infer<typeof FilesystemIndexParamsSchema>;

export function filesystemIndexParamsSchema(): unknown {
  return z.toJSONSchema(FilesystemIndexParamsSchema);
}

export function parseFilesystemIndexParams(raw: unknown): FilesystemIndexParams {
  return FilesystemIndexParamsSchema.parse(raw);
}
