import { z } from 'zod';

export const ConversationsToolRulesSchema = z
  .object({
    allow_other_conversations: z.boolean().default(false),
    max_messages: z.number().finite().int().min(1).max(5000).default(500),
  })
  .strict();

export type ConversationsToolRules = z.infer<typeof ConversationsToolRulesSchema>;

export function parseConversationsToolRules(raw: unknown): ConversationsToolRules {
  return ConversationsToolRulesSchema.parse(raw);
}
