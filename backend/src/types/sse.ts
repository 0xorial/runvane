import type { UserMessageEntry } from "./chatEntry.js";
import { UserMessageEntrySchema } from "./chatEntry.js";
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
  TOOL_INVOCATION_START: "tool_invocation_start",
  TOOL_INVOCATION_END: "tool_invocation_end",
  PLANNER_TURN_STARTED: "planner_turn_started",
  PLANNER_TURN_COMPLETED: "planner_turn_completed",
  TOOL_BATCH_STARTED: "tool_batch_started",
  TOOL_BATCH_COMPLETED: "tool_batch_completed",
  PLANNER_GUARD_STOP: "planner_guard_stop",
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
  group_id: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  prompt_tokens_total: number;
  cached_prompt_tokens_total: number;
  completion_tokens_total: number;
  token_usage_by_model: Array<{
    model_name: string;
    prompt_tokens: number;
    cached_prompt_tokens: number;
    completion_tokens: number;
  }>;
};
export const ConversationSseRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  group_id: z.string().nullable(),
  is_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  prompt_tokens_total: z.number().finite(),
  cached_prompt_tokens_total: z.number().finite(),
  completion_tokens_total: z.number().finite(),
  token_usage_by_model: z.array(
    z.object({
      model_name: z.string(),
      prompt_tokens: z.number().finite(),
      cached_prompt_tokens: z.number().finite(),
      completion_tokens: z.number().finite(),
    }),
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
  chat_entry_id: string;
  conversationIndex: number;
  createdAt: string;
  request_text: string;
  llm_model?: string;
};
export const PlannerStartingSsePayloadSchema = z.object({
  type: z.literal(SseType.PLANNER_STARTING),
  chat_entry_id: z.string(),
  conversationIndex: z.number().finite(),
  createdAt: z.string(),
  request_text: z.string(),
  llm_model: z.string().optional(),
});

export type PlannerLlmStreamSsePayload = {
  type: typeof SseType.PLANNER_LLM_STREAM;
  chat_entry_id: string;
  delta: string;
};
export const PlannerLlmStreamSsePayloadSchema = z.object({
  type: z.literal(SseType.PLANNER_LLM_STREAM),
  chat_entry_id: z.string(),
  delta: z.string(),
});

export type TitleStartingSsePayload = {
  type: typeof SseType.TITLE_STARTING;
  chat_entry_id: string;
  conversationIndex: number;
  createdAt: string;
  request_text: string;
  llm_model?: string;
};
export const TitleStartingSsePayloadSchema = z.object({
  type: z.literal(SseType.TITLE_STARTING),
  chat_entry_id: z.string(),
  conversationIndex: z.number().finite(),
  createdAt: z.string(),
  request_text: z.string(),
  llm_model: z.string().optional(),
});

export type TitleLlmStreamSsePayload = {
  type: typeof SseType.TITLE_LLM_STREAM;
  chat_entry_id: string;
  delta: string;
};
export const TitleLlmStreamSsePayloadSchema = z.object({
  type: z.literal(SseType.TITLE_LLM_STREAM),
  chat_entry_id: z.string(),
  delta: z.string(),
});

export type AssistantStreamSsePayload = {
  type: typeof SseType.ASSISTANT_STREAM;
  chat_entry_id: string;
  delta: string;
};
export const AssistantStreamSsePayloadSchema = z.object({
  type: z.literal(SseType.ASSISTANT_STREAM),
  chat_entry_id: z.string(),
  delta: z.string(),
});

export type PlannerResponseSsePayload = {
  type: typeof SseType.PLANNER_RESPONSE;
  chat_entry_id: string;
  summary: string;
  finished: boolean;
  action?: string;
  tool_name?: string;
  llm_model?: string;
  prompt_tokens?: number;
  cached_prompt_tokens?: number;
  completion_tokens?: number;
};
export const PlannerResponseSsePayloadSchema = z.object({
  type: z.literal(SseType.PLANNER_RESPONSE),
  chat_entry_id: z.string(),
  summary: z.string(),
  finished: z.boolean(),
  action: z.string().optional(),
  tool_name: z.string().optional(),
  llm_model: z.string().optional(),
  prompt_tokens: z.number().finite().optional(),
  cached_prompt_tokens: z.number().finite().optional(),
  completion_tokens: z.number().finite().optional(),
});

export type TitleResponseSsePayload = {
  type: typeof SseType.TITLE_RESPONSE;
  chat_entry_id: string;
  summary: string;
  finished: boolean;
  action?: string;
  llm_model?: string;
  prompt_tokens?: number;
  cached_prompt_tokens?: number;
  completion_tokens?: number;
};
export const TitleResponseSsePayloadSchema = z.object({
  type: z.literal(SseType.TITLE_RESPONSE),
  chat_entry_id: z.string(),
  summary: z.string(),
  finished: z.boolean(),
  action: z.string().optional(),
  llm_model: z.string().optional(),
  prompt_tokens: z.number().finite().optional(),
  cached_prompt_tokens: z.number().finite().optional(),
  completion_tokens: z.number().finite().optional(),
});

export type ToolInvocationStartSsePayload = {
  type: typeof SseType.TOOL_INVOCATION_START;
  chat_entry_id: string;
  tool_name: string;
  approval_required: boolean;
  args_preview?: string;
  approval?: Record<string, unknown>;
  run?: Record<string, unknown>;
  run_steps?: unknown[];
};
export const ToolInvocationStartSsePayloadSchema = z.object({
  type: z.literal(SseType.TOOL_INVOCATION_START),
  chat_entry_id: z.string(),
  tool_name: z.string(),
  approval_required: z.boolean(),
  args_preview: z.string().optional(),
  approval: z.record(z.string(), z.unknown()).optional(),
  run: z.record(z.string(), z.unknown()).optional(),
  run_steps: z.array(z.unknown()).optional(),
});

export type ToolInvocationEndSsePayload = {
  type: typeof SseType.TOOL_INVOCATION_END;
  tool_name: string;
  output: string;
  ok: boolean;
  run_continues?: boolean;
};
export const ToolInvocationEndSsePayloadSchema = z.object({
  type: z.literal(SseType.TOOL_INVOCATION_END),
  tool_name: z.string(),
  output: z.string(),
  ok: z.boolean(),
  run_continues: z.boolean().optional(),
});

export type PlannerTurnStartedSsePayload = {
  type: typeof SseType.PLANNER_TURN_STARTED;
  planner_turn: number;
  max_turns: number;
};
export const PlannerTurnStartedSsePayloadSchema = z.object({
  type: z.literal(SseType.PLANNER_TURN_STARTED),
  planner_turn: z.number().finite(),
  max_turns: z.number().finite(),
});

export type PlannerTurnCompletedSsePayload = {
  type: typeof SseType.PLANNER_TURN_COMPLETED;
  planner_turn: number;
  followup: string;
  tool_calls: number;
};
export const PlannerTurnCompletedSsePayloadSchema = z.object({
  type: z.literal(SseType.PLANNER_TURN_COMPLETED),
  planner_turn: z.number().finite(),
  followup: z.string(),
  tool_calls: z.number().finite(),
});

export type ToolBatchStartedSsePayload = {
  type: typeof SseType.TOOL_BATCH_STARTED;
  batch_id: string;
  total_calls: number;
};
export const ToolBatchStartedSsePayloadSchema = z.object({
  type: z.literal(SseType.TOOL_BATCH_STARTED),
  batch_id: z.string(),
  total_calls: z.number().finite(),
});

export type ToolBatchCompletedSsePayload = {
  type: typeof SseType.TOOL_BATCH_COMPLETED;
  batch_id: string;
  total_calls: number;
};
export const ToolBatchCompletedSsePayloadSchema = z.object({
  type: z.literal(SseType.TOOL_BATCH_COMPLETED),
  batch_id: z.string(),
  total_calls: z.number().finite(),
});

export type PlannerGuardStopSsePayload = {
  type: typeof SseType.PLANNER_GUARD_STOP;
  reason: string;
  planner_turn: number;
  max_turns: number;
};
export const PlannerGuardStopSsePayloadSchema = z.object({
  type: z.literal(SseType.PLANNER_GUARD_STOP),
  reason: z.string(),
  planner_turn: z.number().finite(),
  max_turns: z.number().finite(),
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
  | ToolInvocationStartSsePayload
  | ToolInvocationEndSsePayload
  | PlannerTurnStartedSsePayload
  | PlannerTurnCompletedSsePayload
  | ToolBatchStartedSsePayload
  | ToolBatchCompletedSsePayload
  | PlannerGuardStopSsePayload;
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
  ToolInvocationStartSsePayloadSchema,
  ToolInvocationEndSsePayloadSchema,
  PlannerTurnStartedSsePayloadSchema,
  PlannerTurnCompletedSsePayloadSchema,
  ToolBatchStartedSsePayloadSchema,
  ToolBatchCompletedSsePayloadSchema,
  PlannerGuardStopSsePayloadSchema,
]);

/** Wire event sent over SSE. */
type ConversationScopedPayload = Exclude<SsePayload, ConversationCreatedSsePayload | ConversationUpdatedSsePayload>;

export type SseConversationEvent = ConversationScopedPayload & {
  conversation_id: string;
  seq: number;
};
const SseEnvelopeSchema = z.object({
  conversation_id: z.string(),
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
    chat_entry_id: z.string(),
    conversationIndex: z.number().finite(),
    createdAt: z.string(),
    request_text: z.string(),
    llm_model: z.string().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.PLANNER_LLM_STREAM),
    chat_entry_id: z.string(),
    delta: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TITLE_STARTING),
    chat_entry_id: z.string(),
    conversationIndex: z.number().finite(),
    createdAt: z.string(),
    request_text: z.string(),
    llm_model: z.string().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TITLE_LLM_STREAM),
    chat_entry_id: z.string(),
    delta: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.ASSISTANT_STREAM),
    chat_entry_id: z.string(),
    delta: z.string(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.PLANNER_RESPONSE),
    chat_entry_id: z.string(),
    summary: z.string(),
    finished: z.boolean(),
    action: z.string().optional(),
    tool_name: z.string().optional(),
    llm_model: z.string().optional(),
    prompt_tokens: z.number().finite().optional(),
    cached_prompt_tokens: z.number().finite().optional(),
    completion_tokens: z.number().finite().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TITLE_RESPONSE),
    chat_entry_id: z.string(),
    summary: z.string(),
    finished: z.boolean(),
    action: z.string().optional(),
    llm_model: z.string().optional(),
    prompt_tokens: z.number().finite().optional(),
    cached_prompt_tokens: z.number().finite().optional(),
    completion_tokens: z.number().finite().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TOOL_INVOCATION_START),
    chat_entry_id: z.string(),
    tool_name: z.string(),
    approval_required: z.boolean(),
    args_preview: z.string().optional(),
    approval: z.record(z.string(), z.unknown()).optional(),
    run: z.record(z.string(), z.unknown()).optional(),
    run_steps: z.array(z.unknown()).optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TOOL_INVOCATION_END),
    tool_name: z.string(),
    output: z.string(),
    ok: z.boolean(),
    run_continues: z.boolean().optional(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.PLANNER_TURN_STARTED),
    planner_turn: z.number().finite(),
    max_turns: z.number().finite(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.PLANNER_TURN_COMPLETED),
    planner_turn: z.number().finite(),
    followup: z.string(),
    tool_calls: z.number().finite(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TOOL_BATCH_STARTED),
    batch_id: z.string(),
    total_calls: z.number().finite(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.TOOL_BATCH_COMPLETED),
    batch_id: z.string(),
    total_calls: z.number().finite(),
  }),
  SseRuntimeEnvelopeSchema.extend({
    type: z.literal(SseType.PLANNER_GUARD_STOP),
    reason: z.string(),
    planner_turn: z.number().finite(),
    max_turns: z.number().finite(),
  }),
]);

export type SseConversationMetaEvent =
  | (ConversationCreatedSsePayload & { conversation_id: string; seq: number })
  | (ConversationUpdatedSsePayload & { conversation_id: string; seq: number });
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
