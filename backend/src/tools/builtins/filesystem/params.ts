import { z } from 'zod';

export const FilesystemOperationSchema = z.enum([
  'read_file',
  'list_dir',
  'grep',
  'stat',
  'write_file',
  'edit_file',
]);

export const FilesystemToolParamsSchema = z
  .object({
    operation: FilesystemOperationSchema.describe(
      'read_file returns text content (optionally a line range); list_dir returns directory entries; ' +
        'grep searches file contents under path and returns only matching lines; stat returns metadata (size, mtime, line count); ' +
        'write_file writes content to a path (creating parent dirs), overwriting any existing file; ' +
        'edit_file replaces an exact string in a file and returns a diff.',
    ),
    path: z
      .string()
      .min(1)
      .describe('Absolute or relative path on the host filesystem. For grep, the file or directory to search.'),
    content: z
      .string()
      .optional()
      .describe('File contents to write (write_file only). Written verbatim as UTF-8.'),
    old_string: z
      .string()
      .min(1)
      .optional()
      .describe('Exact text to replace (edit_file only). Must appear exactly once unless replace_all is set.'),
    new_string: z
      .string()
      .optional()
      .describe('Replacement text (edit_file only). May be empty to delete old_string.'),
    replace_all: z
      .boolean()
      .optional()
      .describe('Replace every occurrence of old_string instead of requiring a unique match (edit_file only). Default false.'),
    max_bytes: z
      .number()
      .finite()
      .int()
      .min(1)
      .optional()
      .describe('Optional read cap in bytes (read_file only).'),
    offset: z
      .number()
      .finite()
      .int()
      .min(1)
      .optional()
      .describe('1-based start line for a ranged read (read_file only). Omit to start at line 1.'),
    limit: z
      .number()
      .finite()
      .int()
      .min(1)
      .optional()
      .describe('Number of lines to return from offset (read_file only). Omit to read to EOF (subject to max_bytes).'),
    pattern: z
      .string()
      .min(1)
      .optional()
      .describe('Search pattern (grep only). Literal substring unless is_regex is set.'),
    is_regex: z.boolean().optional().describe('Treat pattern as a JS regular expression (grep only). Default false.'),
    case_sensitive: z.boolean().optional().describe('Case-sensitive match (grep only). Default false.'),
    context_lines: z
      .number()
      .finite()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe('Lines of surrounding context to include with each grep hit (grep only). Default 0.'),
    max_results: z
      .number()
      .finite()
      .int()
      .min(1)
      .optional()
      .describe('Cap on grep hits returned (grep only).'),
  })
  .strict();

export type FilesystemToolParams = z.infer<typeof FilesystemToolParamsSchema>;

export function filesystemParamsSchema(): unknown {
  return z.toJSONSchema(FilesystemToolParamsSchema);
}

export function parseFilesystemToolParams(raw: unknown): FilesystemToolParams {
  return FilesystemToolParamsSchema.parse(raw);
}
