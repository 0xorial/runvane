import type {
  ChatEntry,
  PreparedReasonStepInput,
  UserMessageEntry,
} from './chatEntry.js';

export const SseType = {
  USER_MESSAGE: 'user_message',
  CONVERSATION_CREATED: 'conversation_created',
  CONVERSATION_UPDATED: 'conversation_updated',
  PLANNER_STARTING: 'planner_starting',
  PLANNER_LLM_STREAM: 'planner_llm_stream',
  TITLE_STARTING: 'title_starting',
  TITLE_LLM_STREAM: 'title_llm_stream',
  ASSISTANT_STREAM: 'assistant_stream',
  PLANNER_RESPONSE: 'planner_response',
  TITLE_RESPONSE: 'title_response',
  THOUGHT_PREPARE_STEP_STARTING: 'thought_prepare_step_starting',
  THOUGHT_PREPARE_STEP_FINISHED: 'thought_prepare_step_finished',
  THOUGHT_PREPARE_STEP_FAILED: 'thought_prepare_step_failed',
  THOUGHT_PREPARE_STEP_CANCELLED: 'thought_prepare_step_cancelled',
  THOUGHT_REASON_STEP_STARTING: 'thought_reason_step_starting',
  THOUGHT_REASON_STEP_FINISHED: 'thought_reason_step_finished',
  THOUGHT_REASON_STEP_FAILED: 'thought_reason_step_failed',
  THOUGHT_REASON_STEP_CANCELLED: 'thought_reason_step_cancelled',
  TOOL_INVOCATION_START: 'tool_invocation_start',
  TOOL_INVOCATION_END: 'tool_invocation_end',
  CHAT_ENTRY_UPSERT: 'chat_entry_upsert',
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

type ThoughtStartingSseFields = {
  chatEntryId: string;
  thoughtId: string;
  conversationIndex: number;
  createdAt: string;
  parentId?: string | null;
  requestText: string;
  llmProviderId?: string;
  llmModel?: string;
};

export type PlannerStartingSsePayload = { type: typeof SseType.PLANNER_STARTING } & ThoughtStartingSseFields;
export type TitleStartingSsePayload = { type: typeof SseType.TITLE_STARTING } & ThoughtStartingSseFields;

export type PlannerLlmStreamSsePayload = { type: typeof SseType.PLANNER_LLM_STREAM; chatEntryId: string; delta: string };
export type TitleLlmStreamSsePayload = { type: typeof SseType.TITLE_LLM_STREAM; chatEntryId: string; delta: string };

export type AssistantStreamSsePayload = {
  type: typeof SseType.ASSISTANT_STREAM;
  chatEntryId: string;
  delta: string;
  parentId?: string;
};

type ThoughtResponseSseFields = {
  chatEntryId: string;
  summary: string;
  finished: boolean;
  action?: string;
  toolName?: string;
  llmProviderId?: string;
  llmModel?: string;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
};

export type PlannerResponseSsePayload = { type: typeof SseType.PLANNER_RESPONSE } & ThoughtResponseSseFields;
export type TitleResponseSsePayload = { type: typeof SseType.TITLE_RESPONSE } & Omit<ThoughtResponseSseFields, 'toolName'>;

export type ThoughtPrepareStepStartingSsePayload = {
  type: typeof SseType.THOUGHT_PREPARE_STEP_STARTING;
  chatEntryId: string;
  thoughtId: string;
};
export type ThoughtPrepareStepFinishedSsePayload = {
  type: typeof SseType.THOUGHT_PREPARE_STEP_FINISHED;
  chatEntryId: string;
  preparedReasonStepInput: PreparedReasonStepInput;
};
export type ThoughtPrepareStepFailedSsePayload = {
  type: typeof SseType.THOUGHT_PREPARE_STEP_FAILED;
  chatEntryId: string;
  error: string;
};
export type ThoughtPrepareStepCancelledSsePayload = {
  type: typeof SseType.THOUGHT_PREPARE_STEP_CANCELLED;
  chatEntryId: string;
};

export type ThoughtReasonStepStartingSsePayload = {
  type: typeof SseType.THOUGHT_REASON_STEP_STARTING;
  chatEntryId: string;
};
export type ThoughtReasonStepFinishedSsePayload = {
  type: typeof SseType.THOUGHT_REASON_STEP_FINISHED;
  chatEntryId: string;
  preparedDecisionStepInput: unknown;
};
export type ThoughtReasonStepFailedSsePayload = {
  type: typeof SseType.THOUGHT_REASON_STEP_FAILED;
  chatEntryId: string;
  error: string;
};
export type ThoughtReasonStepCancelledSsePayload = {
  type: typeof SseType.THOUGHT_REASON_STEP_CANCELLED;
  chatEntryId: string;
};

export type ToolInvocationStartSsePayload = {
  type: typeof SseType.TOOL_INVOCATION_START;
  chatEntryId: string;
  toolName: string;
  approvalRequired: boolean;
  parentId?: string;
  argsPreview?: string;
  approval?: Record<string, unknown>;
  run?: Record<string, unknown>;
  runSteps?: unknown[];
};
export type ToolInvocationEndSsePayload = {
  type: typeof SseType.TOOL_INVOCATION_END;
  toolName: string;
  output: string;
  ok: boolean;
  runContinues?: boolean;
};

export type ChatEntryUpsertSsePayload = {
  type: typeof SseType.CHAT_ENTRY_UPSERT;
  entry: ChatEntry;
};

export type SsePayload =
  | UserMessageSsePayload
  | ConversationCreatedSsePayload
  | ConversationUpdatedSsePayload
  | PlannerStartingSsePayload
  | PlannerLlmStreamSsePayload
  | TitleStartingSsePayload
  | TitleLlmStreamSsePayload
  | AssistantStreamSsePayload
  | PlannerResponseSsePayload
  | TitleResponseSsePayload
  | ThoughtPrepareStepStartingSsePayload
  | ThoughtPrepareStepFinishedSsePayload
  | ThoughtPrepareStepFailedSsePayload
  | ThoughtPrepareStepCancelledSsePayload
  | ThoughtReasonStepStartingSsePayload
  | ThoughtReasonStepFinishedSsePayload
  | ThoughtReasonStepFailedSsePayload
  | ThoughtReasonStepCancelledSsePayload
  | ToolInvocationStartSsePayload
  | ToolInvocationEndSsePayload
  | ChatEntryUpsertSsePayload;

export type SseEvent = SsePayload & {
  conversationId: string;
  seq: number;
};
