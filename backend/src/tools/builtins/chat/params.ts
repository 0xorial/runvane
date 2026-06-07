import { z } from 'zod';

export const ChatToolOperationSchema = z.enum(['list_conversations', 'get_conversation', 'list_messages']);

export const ChatToolParamsSchema = z
  .object({
    operation: ChatToolOperationSchema,
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

export type ChatToolParams = z.infer<typeof ChatToolParamsSchema>;

export function chatToolParamsSchema(): unknown {
  return z.toJSONSchema(ChatToolParamsSchema);
}

export function parseChatToolParams(raw: unknown): ChatToolParams {
  return ChatToolParamsSchema.parse(raw);
}
