import { z } from 'zod';

export const FilesystemToolRulesSchema = z
  .object({
    allowed_roots: z
      .array(z.string().min(1))
      .default([])
      .describe('Directory roots the tool may READ from. Resolved paths must stay inside one of these roots.'),
    writable_roots: z
      .array(z.string().min(1))
      .default([])
      .describe(
        'Directory roots write_file/edit_file may write to. Empty (the default) means writes are disabled — ' +
          'enabling the tool for reads never implicitly grants writes. Resolved write paths must stay inside one of these roots.',
      ),
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
    max_grep_results: z
      .number()
      .finite()
      .int()
      .min(1)
      .max(2000)
      .default(200)
      .describe('Hard cap on hits returned by grep.'),
    max_grep_file_bytes: z
      .number()
      .finite()
      .int()
      .min(1024)
      .max(20_000_000)
      .default(2_000_000)
      .describe('Skip files larger than this when scanning with grep.'),
  })
  .strict();

export type FilesystemToolRules = z.infer<typeof FilesystemToolRulesSchema>;

export function parseFilesystemToolRules(raw: unknown): FilesystemToolRules {
  return FilesystemToolRulesSchema.parse(raw);
}
