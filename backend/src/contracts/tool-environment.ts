import { z } from 'zod';

/**
 * A tool environment is *where* a conversation's runtime tools execute. Two are
 * built in — `local` (the in-repo tool-host the server runs) and `none` (no
 * sandbox; runtime tools are unavailable). Users can add `ssh` environments
 * that run the host on another machine. The choice is bound to a conversation.
 */

export const ToolEnvironmentKindSchema = z.enum(['local', 'none', 'ssh']);
export type ToolEnvironmentKind = z.infer<typeof ToolEnvironmentKindSchema>;

export const SshEnvironmentConfigSchema = z.object({
  host: z.string().trim().min(1),
  user: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identityFile: z.string().trim().min(1).optional(),
  /** Command that starts the tool-host on the remote (default `runvane-toolhost`). */
  remoteCommand: z.string().trim().min(1).optional(),
});
export type SshEnvironmentConfig = z.infer<typeof SshEnvironmentConfigSchema>;

export const ToolEnvironmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: ToolEnvironmentKindSchema,
  builtin: z.boolean(),
  ssh: SshEnvironmentConfigSchema.nullable(),
});
export type ToolEnvironment = z.infer<typeof ToolEnvironmentSchema>;

export const LOCAL_ENVIRONMENT_ID = 'local';
export const NONE_ENVIRONMENT_ID = 'none';
export const DEFAULT_TOOL_ENVIRONMENT_ID = LOCAL_ENVIRONMENT_ID;

export const BUILTIN_TOOL_ENVIRONMENTS: ToolEnvironment[] = [
  { id: LOCAL_ENVIRONMENT_ID, name: 'Local', kind: 'local', builtin: true, ssh: null },
  { id: NONE_ENVIRONMENT_ID, name: 'None', kind: 'none', builtin: true, ssh: null },
];

export const BUILTIN_ENVIRONMENT_IDS: readonly string[] = BUILTIN_TOOL_ENVIRONMENTS.map((e) => e.id);

/** AppSetting key under which user-defined (ssh) environments are stored. */
export const TOOL_ENVIRONMENTS_SETTING_KEY = 'tool_environments';

/** Create/update an ssh environment. `id` omitted on create. */
export const UpsertToolEnvironmentRequestSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  ssh: SshEnvironmentConfigSchema,
});
export type UpsertToolEnvironmentRequest = z.infer<typeof UpsertToolEnvironmentRequestSchema>;

export const ListToolEnvironmentsResponseSchema = z.object({
  environments: z.array(ToolEnvironmentSchema),
});
export type ListToolEnvironmentsResponse = z.infer<typeof ListToolEnvironmentsResponseSchema>;

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((i) => `${context}.${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
  return new Error(`${context} validation failed: ${details}`);
}

/** Frontend helper: validate GET /api/tool-environments. */
export function validateListToolEnvironmentsResponse(data: unknown): ListToolEnvironmentsResponse {
  const parsed = ListToolEnvironmentsResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('GET /api/tool-environments', parsed.error);
  return parsed.data;
}

/** Resolve a possibly-missing/legacy env id to a known one (unknown → local). */
export function normalizeEnvironmentId(id: string | null | undefined, known: readonly string[]): string {
  const trimmed = (id ?? '').trim();
  if (trimmed && known.includes(trimmed)) return trimmed;
  return DEFAULT_TOOL_ENVIRONMENT_ID;
}
