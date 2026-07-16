import { z } from 'zod';

/**
 * Category of a well-known agent-context file. Each candidate file (see
 * context-injection.service.ts) is tagged with one of these, so an agent can
 * be configured to preinject only some categories rather than all-or-nothing.
 */
export const PREINJECT_FILE_TYPES = ['instructions', 'manifest', 'readme', 'lint_config', 'env_example'] as const;
export const PreinjectFileTypeSchema = z.enum(PREINJECT_FILE_TYPES);
export type PreinjectFileType = z.infer<typeof PreinjectFileTypeSchema>;

/**
 * `all`: preinject every discovered candidate file.
 * `none`: preinject nothing (default when unset — no behavior change for
 * agents that never configure this).
 * `selected`: preinject only the categories listed in `types`.
 */
export const PreinjectModeSchema = z.enum(['all', 'none', 'selected']);
export type PreinjectMode = z.infer<typeof PreinjectModeSchema>;

export const AgentPreinjectConfigSchema = z.object({
  mode: PreinjectModeSchema,
  /** Only consulted when `mode === 'selected'`. */
  types: z.array(PreinjectFileTypeSchema).optional(),
});
export type AgentPreinjectConfig = z.infer<typeof AgentPreinjectConfigSchema>;

/** `injected`: read and folded into the context-injection entry's content.
 *  `skipped`: discovered on disk but excluded (category not selected, unreadable, or binary). */
export const PreinjectFileStatusSchema = z.enum(['injected', 'skipped']);
export type PreinjectFileStatus = z.infer<typeof PreinjectFileStatusSchema>;

export const PreinjectedFileRecordSchema = z.object({
  /** Repo-relative path (e.g. "README.md", ".github/copilot-instructions.md"). */
  path: z.string(),
  fileType: PreinjectFileTypeSchema,
  status: PreinjectFileStatusSchema,
});
export type PreinjectedFileRecord = z.infer<typeof PreinjectedFileRecordSchema>;

/**
 * Per-message context-files request (`overrides.contextFiles`): the user picked
 * exact candidate paths to fold in with THIS message — the "attach it later"
 * counterpart to the automatic first-message scan. Paths not on the candidate
 * list are ignored (the list is the whole API surface; never arbitrary disk).
 * An explicit override suppresses the automatic first-message scan.
 */
export const ContextFilesOverrideSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
});
export type ContextFilesOverride = z.infer<typeof ContextFilesOverrideSchema>;

// ---- Composer preview (GET /api/context-injection/preview) ----
// Nothing below is ever persisted: it is the record shape plus the content and
// token detail the composer shows BEFORE the first message is sent.

export const PreinjectPreviewFileSchema = PreinjectedFileRecordSchema.extend({
  /** The exact planner section this file contributes (`--- path ---\n<content>`).
   *  Injected files only — the composer's "examine" affordance. */
  content: z.string().optional(),
  /** ~tokens of `content` (same chars/4 estimator as the knowledge preview). */
  tokens: z.number().optional(),
});
export type PreinjectPreviewFile = z.infer<typeof PreinjectPreviewFileSchema>;

export const PreinjectPreviewResultSchema = z.object({
  /** The agent's effective preinject mode ('none' when unset). */
  mode: PreinjectModeSchema,
  files: z.array(PreinjectPreviewFileSchema),
  /** ~tokens of the exact `[Project context files]` block the planner would
   *  receive on a first message (see plannerPrompt); 0 when nothing injects. */
  totalTokens: z.number(),
});
export type PreinjectPreviewResult = z.infer<typeof PreinjectPreviewResultSchema>;
