import { z } from 'zod';

export const FilesystemToolRulesSchema = z
  .object({
    allowed: z
      .enum(['always', 'never', 'ask'])
      .default('ask')
      .describe("Permission behavior for this tool. 'always' auto-allows, 'never' blocks, 'ask' prompts the user."),
    allowed_roots: z
      .array(z.string().min(1))
      .default([])
      .describe('Directory roots the tool may access. Resolved paths must stay inside one of these roots.'),
    max_read_bytes: z
      .number()
      .finite()
      .int()
      .min(256)
      .max(5_000_000)
      .default(200_000)
      .describe('Hard cap on bytes returned by read_file.'),
    max_list_entries: z
      .number()
      .finite()
      .int()
      .min(1)
      .max(5000)
      .default(500)
      .describe('Hard cap on entries returned by list_dir.'),
  })
  .strict();

export type FilesystemToolRules = z.infer<typeof FilesystemToolRulesSchema>;

export function parseFilesystemToolRules(raw: unknown): FilesystemToolRules {
  return FilesystemToolRulesSchema.parse(raw);
}
