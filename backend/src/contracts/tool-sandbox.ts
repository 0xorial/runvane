import { z } from 'zod';

/**
 * A tool sandbox is *where* a conversation's runtime tools execute. Two are
 * built in — `local` (the in-repo tool-host the server runs) and `none` (no
 * sandbox; runtime tools are unavailable). Users can add `ssh` sandboxes
 * that run the host on another machine. The choice is bound to a conversation.
 */

export const ToolSandboxKindSchema = z.enum(['local', 'none', 'ssh']);
export type ToolSandboxKind = z.infer<typeof ToolSandboxKindSchema>;

export const SshSandboxConfigSchema = z.object({
  host: z.string().trim().min(1),
  user: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identityFile: z.string().trim().min(1).optional(),
  /** Command that starts the tool-host on the remote (default `runvane-toolhost`). */
  remoteCommand: z.string().trim().min(1).optional(),
});
export type SshSandboxConfig = z.infer<typeof SshSandboxConfigSchema>;

export const ToolSandboxSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: ToolSandboxKindSchema,
  builtin: z.boolean(),
  ssh: SshSandboxConfigSchema.nullable(),
});
export type ToolSandbox = z.infer<typeof ToolSandboxSchema>;

export const LOCAL_SANDBOX_ID = 'local';
export const NONE_SANDBOX_ID = 'none';
export const DEFAULT_TOOL_SANDBOX_ID = LOCAL_SANDBOX_ID;

export const BUILTIN_TOOL_SANDBOXES: ToolSandbox[] = [
  { id: LOCAL_SANDBOX_ID, name: 'Local', kind: 'local', builtin: true, ssh: null },
  { id: NONE_SANDBOX_ID, name: 'None', kind: 'none', builtin: true, ssh: null },
];

export const BUILTIN_SANDBOX_IDS: readonly string[] = BUILTIN_TOOL_SANDBOXES.map((e) => e.id);

/** AppSetting key under which user-defined (ssh) sandboxes are stored. */
export const TOOL_SANDBOXES_SETTING_KEY = 'tool_environments';

/** Create/update an ssh sandbox. `id` omitted on create. */
export const UpsertToolSandboxRequestSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  ssh: SshSandboxConfigSchema,
});
export type UpsertToolSandboxRequest = z.infer<typeof UpsertToolSandboxRequestSchema>;

export const ListToolSandboxesResponseSchema = z.object({
  sandboxes: z.array(ToolSandboxSchema),
});
export type ListToolSandboxesResponse = z.infer<typeof ListToolSandboxesResponseSchema>;

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((i) => `${context}.${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
  return new Error(`${context} validation failed: ${details}`);
}

/** Frontend helper: validate GET /api/tool-sandboxes. */
export function validateListToolSandboxesResponse(data: unknown): ListToolSandboxesResponse {
  const parsed = ListToolSandboxesResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('GET /api/tool-sandboxes', parsed.error);
  return parsed.data;
}

/** Resolve a possibly-missing/legacy env id to a known one (unknown → local). */
export function normalizeSandboxId(id: string | null | undefined, known: readonly string[]): string {
  const trimmed = (id ?? '').trim();
  if (trimmed && known.includes(trimmed)) return trimmed;
  return DEFAULT_TOOL_SANDBOX_ID;
}
