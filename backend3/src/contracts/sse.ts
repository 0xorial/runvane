import type { ChatEntry, UserMessageEntry } from './chatEntry.js';

export const SseType = {
  USER_MESSAGE: 'user_message',
  CONVERSATION_CREATED: 'conversation_created',
  CONVERSATION_UPDATED: 'conversation_updated',
  CHAT_ENTRY_UPSERT: 'chat_entry_upsert',
  CHAT_ENTRY_DELTA: 'chat_entry_delta',
  THOUGHT_PREPARE_STEP_STARTING: 'thought_prepare_step_starting',
  THOUGHT_PREPARE_STEP_FINISHED: 'thought_prepare_step_finished',
  THOUGHT_PREPARE_STEP_FAILED: 'thought_prepare_step_failed',
  THOUGHT_PREPARE_STEP_CANCELLED: 'thought_prepare_step_cancelled',
  THOUGHT_REASON_STEP_STARTING: 'thought_reason_step_starting',
  THOUGHT_REASON_STEP_FINISHED: 'thought_reason_step_finished',
  THOUGHT_REASON_STEP_FAILED: 'thought_reason_step_failed',
  THOUGHT_REASON_STEP_CANCELLED: 'thought_reason_step_cancelled',
  THOUGHT_DECISION_STEP_STARTING: 'thought_decision_step_starting',
  THOUGHT_DECISION_STEP_FINISHED: 'thought_decision_step_finished',
  THOUGHT_DECISION_STEP_FAILED: 'thought_decision_step_failed',
  THOUGHT_DECISION_STEP_CANCELLED: 'thought_decision_step_cancelled',
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

type StepStartingPayload<T extends SseEventType> = { type: T; chatEntryId: string };
type StepFinishedPayload<T extends SseEventType> = { type: T; chatEntryId: string };
type StepFailedPayload<T extends SseEventType> = { type: T; chatEntryId: string; error: string };
type StepCancelledPayload<T extends SseEventType> = { type: T; chatEntryId: string };

export type ThoughtPrepareStepStartingSsePayload = StepStartingPayload<typeof SseType.THOUGHT_PREPARE_STEP_STARTING> & {
  thoughtId: string;
};
export type ThoughtPrepareStepFinishedSsePayload = StepFinishedPayload<typeof SseType.THOUGHT_PREPARE_STEP_FINISHED>;
export type ThoughtPrepareStepFailedSsePayload = StepFailedPayload<typeof SseType.THOUGHT_PREPARE_STEP_FAILED>;
export type ThoughtPrepareStepCancelledSsePayload = StepCancelledPayload<typeof SseType.THOUGHT_PREPARE_STEP_CANCELLED>;

export type ThoughtReasonStepStartingSsePayload = StepStartingPayload<typeof SseType.THOUGHT_REASON_STEP_STARTING>;
export type ThoughtReasonStepFinishedSsePayload = StepFinishedPayload<typeof SseType.THOUGHT_REASON_STEP_FINISHED>;
export type ThoughtReasonStepFailedSsePayload = StepFailedPayload<typeof SseType.THOUGHT_REASON_STEP_FAILED>;
export type ThoughtReasonStepCancelledSsePayload = StepCancelledPayload<typeof SseType.THOUGHT_REASON_STEP_CANCELLED>;

export type ThoughtDecisionStepStartingSsePayload = StepStartingPayload<typeof SseType.THOUGHT_DECISION_STEP_STARTING>;
export type ThoughtDecisionStepFinishedSsePayload = StepFinishedPayload<typeof SseType.THOUGHT_DECISION_STEP_FINISHED>;
export type ThoughtDecisionStepFailedSsePayload = StepFailedPayload<typeof SseType.THOUGHT_DECISION_STEP_FAILED>;
export type ThoughtDecisionStepCancelledSsePayload = StepCancelledPayload<typeof SseType.THOUGHT_DECISION_STEP_CANCELLED>;

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
  | ThoughtPrepareStepStartingSsePayload
  | ThoughtPrepareStepFinishedSsePayload
  | ThoughtPrepareStepFailedSsePayload
  | ThoughtPrepareStepCancelledSsePayload
  | ThoughtReasonStepStartingSsePayload
  | ThoughtReasonStepFinishedSsePayload
  | ThoughtReasonStepFailedSsePayload
  | ThoughtReasonStepCancelledSsePayload
  | ThoughtDecisionStepStartingSsePayload
  | ThoughtDecisionStepFinishedSsePayload
  | ThoughtDecisionStepFailedSsePayload
  | ThoughtDecisionStepCancelledSsePayload
  | ToolInvocationStartSsePayload
  | ToolInvocationEndSsePayload;

export type SseEvent = SsePayload & {
  conversationId: string;
  seq: number;
};
