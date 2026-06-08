import { z } from 'zod';

export const ConversationsToolOperationSchema = z.enum([
  'list_conversations',
  'get_conversation',
  'list_messages',
]);

export const ConversationsToolParamsSchema = z
  .object({
    operation: ConversationsToolOperationSchema,
    conversation_id: z
      .string()
      .min(1)
      .optional()
      .describe('Target conversation. Defaults to the active chat for get_conversation and list_messages.'),
    all: z
      .boolean()
      .optional()
      .describe('For list_messages: include all branch entries (true) or only the default-view branch (false).'),
    deleted_only: z.boolean().optional().describe('For list_conversations: return only soft-deleted chats.'),
  })
  .strict();

export type ConversationsToolParams = z.infer<typeof ConversationsToolParamsSchema>;

export function conversationsToolParamsSchema(): unknown {
  return z.toJSONSchema(ConversationsToolParamsSchema);
}

export function parseConversationsToolParams(raw: unknown): ConversationsToolParams {
  return ConversationsToolParamsSchema.parse(raw);
}
