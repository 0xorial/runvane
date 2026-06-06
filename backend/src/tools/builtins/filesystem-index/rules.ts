import { z } from 'zod';

export const FilesystemIndexRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('ask'),
    allowed_roots: z.array(z.string().min(1)).default([]),
    max_results: z.number().finite().int().min(1).max(1000).default(100),
  })
  .strict();

export type FilesystemIndexRules = z.infer<typeof FilesystemIndexRulesSchema>;

export function parseFilesystemIndexRules(raw: unknown): FilesystemIndexRules {
  return FilesystemIndexRulesSchema.parse(raw);
}
