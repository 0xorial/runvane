import { z } from 'zod';

export const AskAttachmentRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('always').describe('Permission behavior for this tool.'),
    max_answer_chars: z
      .number()
      .finite()
      .int()
      .min(1)
      .default(8000)
      .describe('Maximum number of characters returned from the subagent answer.'),
    max_attachment_bytes: z
      .number()
      .finite()
      .int()
      .min(1)
      .default(20 * 1024 * 1024)
      .describe('Refuse to ingest attachments larger than this many bytes (per-call guard).'),
  })
  .strict();

export type AskAttachmentRules = z.infer<typeof AskAttachmentRulesSchema>;

export function parseAskAttachmentRules(raw: unknown): AskAttachmentRules {
  return AskAttachmentRulesSchema.parse(raw);
}
