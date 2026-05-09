import type { ChatEntry, PreparedReasonStepInput, UserMessageEntry } from "./chatEntry.js";
import { ChatEntrySchema, PreparedReasonStepInputSchema, UserMessageEntrySchema } from "./chatEntry.js";
import { z } from "zod";

export const SseType = {
  USER_MESSAGE: "user_message",
  CONVERSATION_CREATED: "conversation_created",
  CONVERSATION_UPDATED: "conversation_updated",
  PLANNER_STARTING: "planner_starting",
  PLANNER_LLM_STREAM: "planner_llm_stream",
  TITLE_STARTING: "title_starting",
  TITLE_LLM_STREAM: "title_llm_stream",
  ASSISTANT_STREAM: "assistant_stream",
  PLANNER_RESPONSE: "planner_response",
  TITLE_RESPONSE: "title_response",
  THOUGHT_PREPARE_STEP_STARTING: "thought_prepare_step_starting",
  THOUGHT_PREPARE_STEP_FINISHED: "thought_prepare_step_finished",
  THOUGHT_PREPARE_STEP_FAILED: "thought_prepare_step_failed",
  THOUGHT_PREPARE_STEP_CANCELLED: "thought_prepare_step_cancelled",
  THOUGHT_REASON_STEP_STARTING: "thought_reason_step_starting",
  THOUGHT_REASON_STEP_FINISHED: "thought_reason_step_finished",
  THOUGHT_REASON_STEP_FAILED: "thought_reason_step_failed",
  THOUGHT_REASON_STEP_CANCELLED: "thought_reason_step_cancelled",
  TOOL_INVOCATION_START: "tool_invocation_start", // "upsert", can be sent multiple times
  TOOL_INVOCATION_END: "tool_invocation_end",
  CHAT_ENTRY_UPSERT: "chat_entry_upsert",
} as const;

export type SseEventType = (typeof SseType)[keyof typeof SseType];
export const RUN_SSE_TYPE_VALUES: ReadonlySet<SseEventType> = new Set(Object.values(SseType));

export type UserMessageSsePayload = {
  type: typeof SseType.USER_MESSAGE;
  entry: UserMessageEntry;
};
export const UserMessageSsePayloadSchema = z.object({
  type: z.literal(SseType.USER_MESSAGE),
  entry: UserMessageEntrySchema,
});

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
export const ConversationSseRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  groupId: z.string().nullable(),
  isDeleted: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string(),
  promptTokensTotal: z.number().finite(),
  cachedPromptTokensTotal: z.number().finite(),
  completionTokensTotal: z.number().finite(),
  tokenUsageByModel: z.array(
    z.object({
      modelName: z.string(),
      promptTokens: z.number().finite(),
      cachedPromptTokens: z.number().finite(),
      completionTokens: z.number().finite(),
    })
  ),
});

export type ConversationCreatedSsePayload = {
  type: typeof SseType.CONVERSATION_CREATED;
  conversation: ConversationSseRow;
};
export const ConversationCreatedSsePayloadSchema = z.object({
  type: z.literal(SseType.CONVERSATION_CREATED),
  conversation: ConversationSseRowSchema,
});

export type ConversationUpdatedSsePayload = {
  type: typeof SseType.CONVERSATION_UPDATED;
  conversation: ConversationSseRow;
};
export const ConversationUpdatedSsePayloadSchema = z.object({
  type: z.literal(SseType.CONVERSATION_UPDATED),
  conversation: ConversationSseRowSchema,
});

export type PlannerStartingSsePayload = {
  type: typeof SseType.PLANNER_STARTING;
  chatEntryId: string;
  thoughtId: string;
  conversationIndex: number;
  createdAt: string;
  parentId?: string | null;
  requestText: string;
  llmProviderId?: string;
  llmModel?: string;
};
export const PlannerStartingSsePayloadSchema = z.object({
  type: z.literal(SseType.PLANNER_STARTING),
  chatEntryId: z.string(),
  thoughtId: z.string(),
  conversationIndex: z.number().finite(),
  createdAt: z.string(),
  parentId: z.string().nullable().optional(),
  requestText: z.string(),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
});

export type PlannerLlmStreamSsePayload = {
  type: typeof SseType.PLANNER_LLM_STREAM;
  chatEntryId: string;
  delta: string;
};
export const PlannerLlmStreamSsePayloadSchema = z.object({
  type: z.literal(SseType.PLANNER_LLM_STREAM),
  chatEntryId: z.string(),
  delta: z.string(),
});

export type TitleStartingSsePayload = {
  type: typeof SseType.TITLE_STARTING;
  chatEntryId: string;
  thoughtId: string;
  conversationIndex: number;
  createdAt: string;
  parentId?: string | null;
  requestText: string;
  llmProviderId?: string;
  llmModel?: string;
};
export const TitleStartingSsePayloadSchema = z.object({
  type: z.literal(SseType.TITLE_STARTING),
  chatEntryId: z.string(),
  thoughtId: z.string(),
  conversationIndex: z.number().finite(),
  createdAt: z.string(),
  parentId: z.string().nullable().optional(),
  requestText: z.string(),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
});

export type TitleLlmStreamSsePayload = {
  type: typeof SseType.TITLE_LLM_STREAM;
  chatEntryId: string;
  delta: string;
};
export const TitleLlmStreamSsePayloadSchema = z.object({
  type: z.literal(SseType.TITLE_LLM_STREAM),
  chatEntryId: z.string(),
  delta: z.string(),
});

export type AssistantStreamSsePayload = {
  type: typeof SseType.ASSISTANT_STREAM;
  chatEntryId: string;
  delta: string;
  parentId?: string;
};
export const AssistantStreamSsePayloadSchema = z.object({
  type: z.literal(SseType.ASSISTANT_STREAM),
  chatEntryId: z.string(),
  delta: z.string(),
  parentId: z.string().optional(),
});

export type PlannerResponseSsePayload = {
  type: typeof SseType.PLANNER_RESPONSE;
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
export const PlannerResponseSsePayloadSchema = z.object({
  type: z.literal(SseType.PLANNER_RESPONSE),
  chatEntryId: z.string(),
  summary: z.string(),
  finished: z.boolean(),
  action: z.string().optional(),
  toolName: z.string().optional(),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
  promptTokens: z.number().finite().optional(),
  cachedPromptTokens: z.number().finite().optional(),
  completionTokens: z.number().finite().optional(),
});

export type TitleResponseSsePayload = {
  type: typeof SseType.TITLE_RESPONSE;
  chatEntryId: string;
  summary: string;
  finished: boolean;
  action?: string;
  llmProviderId?: string;
  llmModel?: string;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
};
export const TitleResponseSsePayloadSchema = z.object({
  type: z.literal(SseType.TITLE_RESPONSE),
  chatEntryId: z.string(),
  summary: z.string(),
  finished: z.boolean(),
  action: z.string().optional(),
  llmProviderId: z.string().optional(),
  llmModel: z.string().optional(),
  promptTokens: z.number().finite().optional(),
  cachedPromptTokens: z.number().finite().optional(),
  completionTokens: z.number().finite().optional(),
});

export type ThoughtPrepareStepStartingSsePayload = {
  type: typeof SseType.THOUGHT_PREPARE_STEP_STARTING;
  chatEntryId: string;
  thoughtId: string;
};
export const ThoughtPrepareStepStartingSsePayloadSchema = z.object({
  type: z.literal(SseType.THOUGHT_PREPARE_STEP_STARTING),
  chatEntryId: z.string(),
  thoughtId: z.string(),
});

export type ThoughtPrepareStepFinishedSsePayload = {
  type: typeof SseType.THOUGHT_PREPARE_STEP_FINISHED;
  chatEntryId: string;
  preparedReasonStepInput: PreparedReasonStepInput;
};
export const ThoughtPrepareStepFinishedSsePayloadSchema = z.object({
  type: z.literal(SseType.THOUGHT_PREPARE_STEP_FINISHED),
  chatEntryId: z.string(),
  preparedReasonStepInput: PreparedReasonStepInputSchema,
});

export type ThoughtPrepareStepFailedSsePayload = {
  type: typeof SseType.THOUGHT_PREPARE_STEP_FAILED;
  chatEntryId: string;
  error: string;
};
export const ThoughtPrepareStepFailedSsePayloadSchema = z.object({
  type: z.literal(SseType.THOUGHT_PREPARE_STEP_FAILED),
  chatEntryId: z.string(),
  error: z.string(),
});

export type ThoughtPrepareStepCancelledSsePayload = {
  type: typeof SseType.THOUGHT_PREPARE_STEP_CANCELLED;
  chatEntryId: string;
};
export const ThoughtPrepareStepCancelledSsePayloadSchema = z.object({
  type: z.literal(SseType.THOUGHT_PREPARE_STEP_CANCELLED),
  chatEntryId: z.string(),
});

export type ThoughtReasonStepStartingSsePayload = {
  type: typeof SseType.THOUGHT_REASON_STEP_STARTING;
  chatEntryId: string;
};
export const ThoughtReasonStepStartingSsePayloadSchema = z.object({
  type: z.literal(SseType.THOUGHT_REASON_STEP_STARTING),
  chatEntryId: z.string(),
});

export type ThoughtReasonStepFinishedSsePayload = {
  type: typeof SseType.THOUGHT_REASON_STEP_FINISHED;
  chatEntryId: string;
  preparedDecisionStepInput: unknown;
};
export const ThoughtReasonStepFinishedSsePayloadSchema = z.object({
  type: z.literal(SseType.THOUGHT_REASON_STEP_FINISHED),
  chatEntryId: z.string(),
  preparedDecisionStepInput: z.unknown(),
});

export type ThoughtReasonStepFailedSsePayload = {
  type: typeof SseType.THOUGHT_REASON_STEP_FAILED;
  chatEntryId: string;
  error: string;
};
export const ThoughtReasonStepFailedSsePayloadSchema = z.object({
  type: z.literal(SseType.THOUGHT_REASON_STEP_FAILED),
  chatEntryId: z.string(),
  error: z.string(),
});

export type ThoughtReasonStepCancelledSsePayload = {
  type: typeof SseType.THOUGHT_REASON_STEP_CANCELLED;
  chatEntryId: string;
};
export const ThoughtReasonStepCancelledSsePayloadSchema = z.object({
  type: z.literal(SseType.THOUGHT_REASON_STEP_CANCELLED),
  chatEntryId: z.string(),
});

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
export const ToolInvocationStartSsePayloadSchema = z.object({
  type: z.literal(SseType.TOOL_INVOCATION_START),
  chatEntryId: z.string(),
  toolName: z.string(),
  approvalRequired: z.boolean(),
  parentId: z.string().optional(),
  argsPreview: z.string().optional(),
  approval: z.record(z.string(), z.unknown()).optional(),
  run: z.record(z.string(), z.unknown()).optional(),
  runSteps: z.array(z.unknown()).optional(),
});

export type ToolInvocationEndSsePayload = {
  type: typeof SseType.TOOL_INVOCATION_END;
  toolName: string;
  output: string;
  ok: boolean;
  runContinues?: boolean;
};
export const ToolInvocationEndSsePayloadSchema = z.object({
  type: z.literal(SseType.TOOL_INVOCATION_END),
  toolName: z.string(),
  output: z.string(),
  ok: z.boolean(),
  runContinues: z.boolean().optional(),
});

export type ChatEntryUpsertSsePayload = {
  type: typeof SseType.CHAT_ENTRY_UPSERT;
  entry: ChatEntry;
};
export const ChatEntryUpsertSsePayloadSchema = z.object({
  type: z.literal(SseType.CHAT_ENTRY_UPSERT),
  entry: ChatEntrySchema,
});

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
export const SsePayloadSchema = z.discriminatedUnion("type", [
  UserMessageSsePayloadSchema,
  ConversationCreatedSsePayloadSchema,
  ConversationUpdatedSsePayloadSchema,
  PlannerStartingSsePayloadSchema,
  PlannerLlmStreamSsePayloadSchema,
  TitleStartingSsePayloadSchema,
  TitleLlmStreamSsePayloadSchema,
  AssistantStreamSsePayloadSchema,
  PlannerResponseSsePayloadSchema,
  TitleResponseSsePayloadSchema,
  ThoughtPrepareStepStartingSsePayloadSchema,
  ThoughtPrepareStepFinishedSsePayloadSchema,
  ThoughtPrepareStepFailedSsePayloadSchema,
  ThoughtPrepareStepCancelledSsePayloadSchema,
  ThoughtReasonStepStartingSsePayloadSchema,
  ThoughtReasonStepFinishedSsePayloadSchema,
  ThoughtReasonStepFailedSsePayloadSchema,
  ThoughtReasonStepCancelledSsePayloadSchema,
  ToolInvocationStartSsePayloadSchema,
  ToolInvocationEndSsePayloadSchema,
  ChatEntryUpsertSsePayloadSchema,
]);

/** Wire event sent over SSE. */
type ConversationScopedPayload = Exclude<SsePayload, ConversationCreatedSsePayload | ConversationUpdatedSsePayload>;

export type SseConversationEvent = ConversationScopedPayload & {
  conversationId: string;
  seq: number;
};
const SseEnvelopeSchema = z.object({
  conversationId: z.string(),
});
const SseRuntimeEnvelopeSchema = SseEnvelopeSchema.extend({
  seq: z.number().finite(),
});
export const SseConversationEventSchema = z.discriminatedUnion("type", [
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.USER_MESSAGE),
    entry: UserMessageEntrySchema,
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.PLANNER_STARTING),
    chatEntryId: z.string(),
    thoughtId: z.string(),
    conversationIndex: z.number().finite(),
    createdAt: z.string(),
    parentId: z.string().nullable().optional(),
    requestText: z.string(),
    llmProviderId: z.string().optional(),
    llmModel: z.string().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.PLANNER_LLM_STREAM),
    chatEntryId: z.string(),
    delta: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TITLE_STARTING),
    chatEntryId: z.string(),
    thoughtId: z.string(),
    conversationIndex: z.number().finite(),
    createdAt: z.string(),
    parentId: z.string().nullable().optional(),
    requestText: z.string(),
    llmProviderId: z.string().optional(),
    llmModel: z.string().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TITLE_LLM_STREAM),
    chatEntryId: z.string(),
    delta: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.ASSISTANT_STREAM),
    chatEntryId: z.string(),
    delta: z.string(),
    parentId: z.string().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.PLANNER_RESPONSE),
    chatEntryId: z.string(),
    summary: z.string(),
    finished: z.boolean(),
    action: z.string().optional(),
    toolName: z.string().optional(),
    llmProviderId: z.string().optional(),
    llmModel: z.string().optional(),
    promptTokens: z.number().finite().optional(),
    cachedPromptTokens: z.number().finite().optional(),
    completionTokens: z.number().finite().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TITLE_RESPONSE),
    chatEntryId: z.string(),
    summary: z.string(),
    finished: z.boolean(),
    action: z.string().optional(),
    llmProviderId: z.string().optional(),
    llmModel: z.string().optional(),
    promptTokens: z.number().finite().optional(),
    cachedPromptTokens: z.number().finite().optional(),
    completionTokens: z.number().finite().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.THOUGHT_PREPARE_STEP_STARTING),
    chatEntryId: z.string(),
    thoughtId: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.THOUGHT_PREPARE_STEP_FINISHED),
    chatEntryId: z.string(),
    preparedReasonStepInput: PreparedReasonStepInputSchema,
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.THOUGHT_PREPARE_STEP_FAILED),
    chatEntryId: z.string(),
    error: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.THOUGHT_PREPARE_STEP_CANCELLED),
    chatEntryId: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.THOUGHT_REASON_STEP_STARTING),
    chatEntryId: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.THOUGHT_REASON_STEP_FINISHED),
    chatEntryId: z.string(),
    preparedDecisionStepInput: z.unknown(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.THOUGHT_REASON_STEP_FAILED),
    chatEntryId: z.string(),
    error: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.THOUGHT_REASON_STEP_CANCELLED),
    chatEntryId: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TOOL_INVOCATION_START),
    chatEntryId: z.string(),
    toolName: z.string(),
    approvalRequired: z.boolean(),
    parentId: z.string().optional(),
    argsPreview: z.string().optional(),
    approval: z.record(z.string(), z.unknown()).optional(),
    run: z.record(z.string(), z.unknown()).optional(),
    runSteps: z.array(z.unknown()).optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TOOL_INVOCATION_END),
    toolName: z.string(),
    output: z.string(),
    ok: z.boolean(),
    runContinues: z.boolean().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.CHAT_ENTRY_UPSERT),
    entry: ChatEntrySchema,
  }),
]);

export type SseConversationMetaEvent =
  | (ConversationCreatedSsePayload & { conversationId: string; seq: number })
  | (ConversationUpdatedSsePayload & { conversationId: string; seq: number });
export const SseConversationMetaEventSchema = z.discriminatedUnion("type", [
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.CONVERSATION_CREATED),
    conversation: ConversationSseRowSchema,
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.CONVERSATION_UPDATED),
    conversation: ConversationSseRowSchema,
  }),
]);

export type SseEvent = SseConversationEvent | SseConversationMetaEvent;
export const SseEventSchema: z.ZodType<SseEvent> = z.union([
  SseConversationEventSchema,
  SseConversationMetaEventSchema,
]);

export function parseSseEventObject(raw: unknown): SseEvent | null {
  const parsed = SseEventSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseSseEvent(data: string): SseEvent | null {
  return parseSseEventObject(JSON.parse(data) as unknown);
}

export function sseEventType(ev: unknown): SseEventType | null {
  if (!ev || typeof ev !== "object" || Array.isArray(ev)) return null;
  const t = (ev as { type?: unknown }).type;
  return typeof t === "string" && RUN_SSE_TYPE_VALUES.has(t as SseEventType) ? (t as SseEventType) : null;
}

export function isSseEvent(ev: unknown): ev is SseEvent {
  return parseSseEventObject(ev) !== null;
}
