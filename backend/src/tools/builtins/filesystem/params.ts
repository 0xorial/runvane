import { z } from 'zod';

export const FilesystemOperationSchema = z.enum(['read_file', 'list_dir']);

export const FilesystemToolParamsSchema = z
  .object({
    operation: FilesystemOperationSchema.describe('read_file returns text content; list_dir returns directory entries.'),
    path: z.string().min(1).describe('Absolute or relative path on the host filesystem.'),
    max_bytes: z
      .number()
      .finite()
      .int()
      .min(1)
      .optional()
      .describe('Optional read cap in bytes (read_file only).'),
  })
  .strict();

export type FilesystemToolParams = z.infer<typeof FilesystemToolParamsSchema>;

export function filesystemParamsSchema(): unknown {
  return z.toJSONSchema(FilesystemToolParamsSchema);
}

export function parseFilesystemToolParams(raw: unknown): FilesystemToolParams {
  return FilesystemToolParamsSchema.parse(raw);
}
