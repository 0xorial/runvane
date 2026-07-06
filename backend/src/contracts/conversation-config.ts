import { z } from 'zod';

/**
 * The "system query" that classifies a conversation into a category. The
 * categorizer appends the candidate category list and a fixed format reminder,
 * so this is just the instruction/role text — editable in Settings.
 */
export const DEFAULT_CATEGORIZATION_PROMPT =
  'You organize a personal AI chat client. Classify the conversation below into a single, broad ' +
  'topic category that would group it with similar chats. Strongly prefer one of the existing ' +
  'categories when it reasonably fits; only invent a new, concise category (1-3 words) when none ' +
  'of them are a good match. Categories should be reusable across many conversations, not specific ' +
  'to a single chat.';

export const ConversationCategorizationConfigSchema = z.object({
  /** Master switch for the auto-categorizer (runs once after the first message). */
  enabled: z.boolean(),
  /** How many of the most-recent conversations the slim left sidebar shows. */
  sidebarRecentLimit: z.number().int().min(1).max(200),
  /** The editable system instruction used to classify a conversation. */
  prompt: z.string().trim().min(1).max(8000),
});
export type ConversationCategorizationConfig = z.infer<typeof ConversationCategorizationConfigSchema>;

export const DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG: ConversationCategorizationConfig = {
  enabled: true,
  sidebarRecentLimit: 25,
  prompt: DEFAULT_CATEGORIZATION_PROMPT,
};

/** Settings key in the `settings` (AppSetting) key/value table. */
export const CONVERSATION_CATEGORIZATION_SETTING_KEY = 'conversation_categorization';

/**
 * Merge a stored (possibly partial / legacy) config blob with defaults so the
 * API and the categorizer always see a complete, valid config.
 */
export function normalizeConversationCategorizationConfig(raw: unknown): ConversationCategorizationConfig {
  const base = { ...DEFAULT_CONVERSATION_CATEGORIZATION_CONFIG };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    if (typeof rec.enabled === 'boolean') base.enabled = rec.enabled;
    if (typeof rec.sidebarRecentLimit === 'number' && Number.isFinite(rec.sidebarRecentLimit)) {
      base.sidebarRecentLimit = Math.min(200, Math.max(1, Math.trunc(rec.sidebarRecentLimit)));
    }
    if (typeof rec.prompt === 'string' && rec.prompt.trim()) {
      base.prompt = rec.prompt.trim().slice(0, 8000);
    }
  }
  return base;
}

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((i) => `${context}.${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
  return new Error(`${context} validation failed: ${details}`);
}

export function validateConversationCategorizationConfig(
  data: unknown,
  context: string,
): ConversationCategorizationConfig {
  const parsed = ConversationCategorizationConfigSchema.safeParse(data);
  if (!parsed.success) throw formatZodError(context, parsed.error);
  return parsed.data;
}
