import { z } from 'zod';

export const ChatToolRulesSchema = z
  .object({
    allowed: z.enum(['always', 'never', 'ask']).default('always'),
    allow_other_conversations: z.boolean().default(false),
    max_messages: z.number().finite().int().min(1).max(5000).default(500),
  })
  .strict();

export type ChatToolRules = z.infer<typeof ChatToolRulesSchema>;

export function parseChatToolRules(raw: unknown): ChatToolRules {
  return ChatToolRulesSchema.parse(raw);
}
