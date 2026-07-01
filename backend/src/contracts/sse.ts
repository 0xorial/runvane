import { z } from 'zod';
import { ChatEntrySchema, UserMessageEntrySchema } from './chatEntry.js';

export const SseType = {
  USER_MESSAGE: 'user_message',
  CONVERSATION_CREATED: 'conversation_created',
  CONVERSATION_UPDATED: 'conversation_updated',
  CHAT_ENTRY_UPSERT: 'chat_entry_upsert',
  CHAT_ENTRY_DELTA: 'chat_entry_delta',
  CONVERSATION_SNAPSHOT: 'conversation_snapshot',
  TOOL_INVOCATION_START: 'tool_invocation_start',
  TOOL_INVOCATION_END: 'tool_invocation_end',
  TOOL_INVOCATION_PROGRESS: 'tool_invocation_progress',
  MESSAGE_ENQUEUED: 'message_enqueued',
  MESSAGE_DEQUEUED: 'message_dequeued',
} as const;

export type SseEventType = (typeof SseType)[keyof typeof SseType];

// ---- SSE payload schemas ----

export const ConversationSseRowSchema = z.object({
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
  providerCostTotal: z.number(),
  providerCostPartial: z.boolean(),
  /** User's branch anchor (stored on conversation); client resolves to live tip. */
  defaultViewLeafAnchorId: z.string().nullable(),
  tokenUsageByModel: z.array(
    z.object({
      modelName: z.string(),
      promptTokens: z.number(),
      cachedPromptTokens: z.number(),
      completionTokens: z.number(),
    }),
  ),
});
export type ConversationSseRow = z.infer<typeof ConversationSseRowSchema>;

export const UserMessageSsePayloadSchema = z.object({
  type: z.literal(SseType.USER_MESSAGE),
  entry: UserMessageEntrySchema,
  clientRequestId: z.string().optional(),
});
export type UserMessageSsePayload = z.infer<typeof UserMessageSsePayloadSchema>;

export const ConversationCreatedSsePayloadSchema = z.object({
  type: z.literal(SseType.CONVERSATION_CREATED),
  conversation: ConversationSseRowSchema,
});
export type ConversationCreatedSsePayload = z.infer<typeof ConversationCreatedSsePayloadSchema>;

export const ConversationUpdatedSsePayloadSchema = z.object({
  type: z.literal(SseType.CONVERSATION_UPDATED),
  conversation: ConversationSseRowSchema,
});
export type ConversationUpdatedSsePayload = z.infer<typeof ConversationUpdatedSsePayloadSchema>;

export const ChatEntryUpsertSsePayloadSchema = z.object({
  type: z.literal(SseType.CHAT_ENTRY_UPSERT),
  entry: ChatEntrySchema,
});
export type ChatEntryUpsertSsePayload = z.infer<typeof ChatEntryUpsertSsePayloadSchema>;

/**
 * First frame of a per-conversation stream: the full entries snapshot. The
 * envelope `seq` is the watermark W — the client baselines on it and applies
 * later frames only when their seq > W.
 */
export const ConversationSnapshotSsePayloadSchema = z.object({
  type: z.literal(SseType.CONVERSATION_SNAPSHOT),
  entries: z.array(ChatEntrySchema),
  /** Resolved default-view leaf + the user's stored anchor, so the client seeds
   * the same branch view a fresh page load would. */
  leafId: z.string().nullable(),
  anchorId: z.string().nullable(),
});
export type ConversationSnapshotSsePayload = z.infer<typeof ConversationSnapshotSsePayloadSchema>;

export const ChatEntryDeltaSsePayloadSchema = z.object({
  type: z.literal(SseType.CHAT_ENTRY_DELTA),
  chatEntryId: z.string(),
  field: z.enum(['llmResponse', 'thinkingText', 'text']),
  delta: z.string(),
  parentId: z.string().optional(),
});
export type ChatEntryDeltaField = z.infer<typeof ChatEntryDeltaSsePayloadSchema>['field'];
export type ChatEntryDeltaSsePayload = z.infer<typeof ChatEntryDeltaSsePayloadSchema>;

export const ToolInvocationStartSsePayloadSchema = z.object({
  type: z.literal(SseType.TOOL_INVOCATION_START),
  chatEntryId: z.string(),
  toolName: z.string(),
  state: z.enum(['requested', 'running']),
  approvalRequired: z.boolean(),
  parentId: z.string().optional(),
  argsPreview: z.string().optional(),
});
export type ToolInvocationStartSsePayload = z.infer<typeof ToolInvocationStartSsePayloadSchema>;

export const ToolInvocationEndSsePayloadSchema = z.object({
  type: z.literal(SseType.TOOL_INVOCATION_END),
  chatEntryId: z.string(),
  toolName: z.string(),
  ok: z.boolean(),
  output: z.string(),
  runContinues: z.boolean(),
});
export type ToolInvocationEndSsePayload = z.infer<typeof ToolInvocationEndSsePayloadSchema>;

/** Incremental live output from a running tool (stdout, streamed tokens, …). */
export const ToolInvocationProgressSsePayloadSchema = z.object({
  type: z.literal(SseType.TOOL_INVOCATION_PROGRESS),
  chatEntryId: z.string(),
  toolName: z.string(),
  delta: z.string(),
});
export type ToolInvocationProgressSsePayload = z.infer<typeof ToolInvocationProgressSsePayloadSchema>;

/** A user message held in the per-conversation queue, awaiting drain. */
export const MessageEnqueuedSsePayloadSchema = z.object({
  type: z.literal(SseType.MESSAGE_ENQUEUED),
  clientRequestId: z.string(),
  text: z.string(),
});
export type MessageEnqueuedSsePayload = z.infer<typeof MessageEnqueuedSsePayloadSchema>;

/** A queued message left the queue — drained into a real run, or cancelled. */
export const MessageDequeuedSsePayloadSchema = z.object({
  type: z.literal(SseType.MESSAGE_DEQUEUED),
  clientRequestId: z.string(),
});
export type MessageDequeuedSsePayload = z.infer<typeof MessageDequeuedSsePayloadSchema>;

export const SsePayloadSchema = z.discriminatedUnion('type', [
  UserMessageSsePayloadSchema,
  ConversationCreatedSsePayloadSchema,
  ConversationUpdatedSsePayloadSchema,
  ChatEntryUpsertSsePayloadSchema,
  ConversationSnapshotSsePayloadSchema,
  ChatEntryDeltaSsePayloadSchema,
  ToolInvocationStartSsePayloadSchema,
  ToolInvocationEndSsePayloadSchema,
  ToolInvocationProgressSsePayloadSchema,
  MessageEnqueuedSsePayloadSchema,
  MessageDequeuedSsePayloadSchema,
]);
export type SsePayload = z.infer<typeof SsePayloadSchema>;

export type SseEvent = SsePayload & {
  conversationId: string;
  seq: number;
};
