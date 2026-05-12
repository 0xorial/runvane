import type { ChatEntry, UserMessageEntry } from './chatEntry.js';

export const SseType = {
  USER_MESSAGE: 'user_message',
  CONVERSATION_CREATED: 'conversation_created',
  CONVERSATION_UPDATED: 'conversation_updated',
  CHAT_ENTRY_UPSERT: 'chat_entry_upsert',
  CHAT_ENTRY_DELTA: 'chat_entry_delta',
  TOOL_INVOCATION_START: 'tool_invocation_start',
  TOOL_INVOCATION_END: 'tool_invocation_end',
} as const;

export type SseEventType = (typeof SseType)[keyof typeof SseType];

export type ConversationSseRow = {
  id: string;
  title: string;
  groupId: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  promptTokensTotal: number;
  cachedPromptTokensTotal: number;
  completionTokensTotal: number;
  tokenUsageByModel: Array<{
    modelName: string;
    promptTokens: number;
    cachedPromptTokens: number;
    completionTokens: number;
  }>;
};

export type UserMessageSsePayload = { type: typeof SseType.USER_MESSAGE; entry: UserMessageEntry };
export type ConversationCreatedSsePayload = { type: typeof SseType.CONVERSATION_CREATED; conversation: ConversationSseRow };
export type ConversationUpdatedSsePayload = { type: typeof SseType.CONVERSATION_UPDATED; conversation: ConversationSseRow };

export type ChatEntryUpsertSsePayload = { type: typeof SseType.CHAT_ENTRY_UPSERT; entry: ChatEntry };

export type ChatEntryDeltaField = 'llmResponse' | 'text';
export type ChatEntryDeltaSsePayload = {
  type: typeof SseType.CHAT_ENTRY_DELTA;
  chatEntryId: string;
  field: ChatEntryDeltaField;
  delta: string;
  parentId?: string;
};

export type ToolInvocationStartSsePayload = {
  type: typeof SseType.TOOL_INVOCATION_START;
  chatEntryId: string;
  toolName: string;
  state: 'requested' | 'running';
  approvalRequired: boolean;
  parentId?: string;
  argsPreview?: string;
};
export type ToolInvocationEndSsePayload = {
  type: typeof SseType.TOOL_INVOCATION_END;
  chatEntryId: string;
  toolName: string;
  ok: boolean;
  output: string;
  runContinues: boolean;
};

export type SsePayload =
  | UserMessageSsePayload
  | ConversationCreatedSsePayload
  | ConversationUpdatedSsePayload
  | ChatEntryUpsertSsePayload
  | ChatEntryDeltaSsePayload
  | ToolInvocationStartSsePayload
  | ToolInvocationEndSsePayload;

export type SseEvent = SsePayload & {
  conversationId: string;
  seq: number;
};
