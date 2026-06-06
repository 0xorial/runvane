import { z } from 'zod';
import { AttachmentModeSchema, ChatEntrySchema, UserMessageEntrySchema } from './chatEntry.js';
import { LlmRefSchema } from './llm.js';

export const PostMessageAttachmentSchema = z.object({
  id: z.string().min(1),
  mode: AttachmentModeSchema,
});
export type PostMessageAttachment = z.infer<typeof PostMessageAttachmentSchema>;

// Re-export so consumers that import ChatEntry via this module keep working.
export type { ChatEntry } from './chatEntry.js';
export type ChatMessageEntry = z.infer<typeof ChatEntrySchema>;

// ---- Conversation rows ----

export const ConversationTokenUsageByModelSchema = z.object({
  modelName: z.string(),
  promptTokens: z.number(),
  cachedPromptTokens: z.number(),
  completionTokens: z.number(),
});

export const ConversationRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  groupId: z.string().nullable(),
  isDeleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string(),
  promptTokensTotal: z.number(),
  cachedPromptTokensTotal: z.number(),
  completionTokensTotal: z.number(),
  /** Stored branch anchor; walk descendants to resolve the live view tip. */
  defaultViewLeafAnchorId: z.string().nullable(),
  /** Resolved live tip of the anchored branch (API convenience). */
  defaultViewLeafEntryId: z.string().nullable(),
  tokenUsageByModel: z.array(ConversationTokenUsageByModelSchema),
});
export type ConversationRow = z.infer<typeof ConversationRowSchema>;

export const ConversationGroupRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationGroupRow = z.infer<typeof ConversationGroupRowSchema>;

export const GetConversationsResponseSchema = z.object({
  conversations: z.array(ConversationRowSchema),
  groups: z.array(ConversationGroupRowSchema),
});
export type GetConversationsResponse = z.infer<typeof GetConversationsResponseSchema>;

// ---- Request / response shapes ----

export const CreateConversationRequestSchema = z.object({ title: z.string().min(1).optional() });
export type CreateConversationRequest = z.infer<typeof CreateConversationRequestSchema>;

export const UpdateConversationRequestSchema = z.object({
  title: z.string().min(1).optional(),
  groupId: z.string().min(1).nullable().optional(),
  newGroupName: z.string().min(1).optional(),
});
export type UpdateConversationRequest = z.infer<typeof UpdateConversationRequestSchema>;

export const PostConversationMessageRequestSchema = z.object({
  message: z.string().min(1),
  agentId: z.string().min(1),
  llm: LlmRefSchema.optional(),
  modelPresetId: z.number().int().min(1).optional(),
  attachments: z.array(PostMessageAttachmentSchema).optional(),
  parentId: z.string().min(1).nullable().optional(),
  clientRequestId: z.string().min(1).optional(),
  /** Abort in-flight processing and start this message immediately. */
  steer: z.boolean().optional(),
});
export type PostConversationMessageRequest = z.infer<typeof PostConversationMessageRequestSchema>;

export const PostConversationMessageAcceptedResponseSchema = z.object({
  conversationId: z.string(),
});
export type PostConversationMessageAcceptedResponse = z.infer<typeof PostConversationMessageAcceptedResponseSchema>;

export const SetConversationActiveLeafRequestSchema = z.object({ entryId: z.string().min(1) });
export type SetConversationActiveLeafRequest = z.infer<typeof SetConversationActiveLeafRequestSchema>;

export const ReprocessContextRequestSchema = z.object({
  editedRequestText: z.string().min(1),
  llm: LlmRefSchema.optional(),
});
export type ReprocessContextRequest = z.infer<typeof ReprocessContextRequestSchema>;

export const ReprocessReasonRequestSchema = z.object({ editedResponse: z.string().min(1) });
export type ReprocessReasonRequest = z.infer<typeof ReprocessReasonRequestSchema>;

export const ReprocessUserMessageRequestSchema = z.object({ editedText: z.string().min(1) });
export type ReprocessUserMessageRequest = z.infer<typeof ReprocessUserMessageRequestSchema>;

export const SummarizeConversationRequestSchema = z.object({ firstEntryToSummarize: z.string().min(1) });
export type SummarizeConversationRequest = z.infer<typeof SummarizeConversationRequestSchema>;

// ---- Frontend validation helpers ----
// These are used by the frontend to validate HTTP responses received from the backend.

function formatZodError(context: string, err: z.ZodError): Error {
  const details = err.issues.map((i) => `${context}.${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
  return new Error(`${context} validation failed: ${details}`);
}

function parseChatMessageEntry(value: unknown, index: number): ChatMessageEntry {
  const parsed = ChatEntrySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    const role = rec.role;
    if (role === 'user') {
      const agentId = String(rec.agentId ?? '').trim();
      if (!agentId) {
        throw new Error('GET /api/conversations/:id/messages validation failed: user role message missing agentId');
      }
      return {
        type: 'user-message',
        id: typeof rec.id === 'string' ? rec.id : '',
        text: typeof rec.text === 'string' ? rec.text : '',
        parentId: typeof rec.parentId === 'string' ? rec.parentId : null,
        agentId,
        conversationIndex:
          typeof rec.conversationIndex === 'number' && Number.isFinite(rec.conversationIndex)
            ? rec.conversationIndex
            : index,
        createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
      };
    }
    if (role === 'assistant') {
      return {
        type: 'assistant-message',
        id: typeof rec.id === 'string' ? rec.id : '',
        text: typeof rec.text === 'string' ? rec.text : '',
        parentId: typeof rec.parentId === 'string' ? rec.parentId : null,
        conversationIndex:
          typeof rec.conversationIndex === 'number' && Number.isFinite(rec.conversationIndex)
            ? rec.conversationIndex
            : index,
        createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : new Date().toISOString(),
      };
    }
  }
  throw formatZodError('GET /api/conversations/:id/messages', parsed.error);
}

export function validateConversationRowResponse(value: unknown, context: string): ConversationRow {
  const parsed = ConversationRowSchema.safeParse(value);
  if (!parsed.success) throw formatZodError(context, parsed.error);
  return parsed.data;
}

export function validateGetConversationsResponse(data: unknown): GetConversationsResponse {
  const parsed = GetConversationsResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('GET /api/conversations', parsed.error);
  return parsed.data;
}

export function validatePostConversationsResponse(data: unknown): ConversationRow {
  return validateConversationRowResponse(data, 'POST /api/conversations');
}

export function validateGetConversationMessagesResponse(data: unknown): ChatMessageEntry[] {
  const arr = z.array(z.unknown()).safeParse(data);
  if (!arr.success) throw formatZodError('GET /api/conversations/:id/messages', arr.error);
  return arr.data.map((row, i) => parseChatMessageEntry(row, i));
}

export function validatePostConversationMessageResponse(data: unknown): PostConversationMessageAcceptedResponse {
  const parsed = PostConversationMessageAcceptedResponseSchema.safeParse(data);
  if (!parsed.success) throw formatZodError('POST /api/conversations/:id/messages', parsed.error);
  return parsed.data;
}

// Named export for SSE / sse-hub usage
export { ChatEntrySchema, UserMessageEntrySchema };
