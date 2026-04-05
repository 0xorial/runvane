import {
  SseType,
  type SseEventType,
  type SsePayload,
  type SseConversationEvent,
  type SseConversationMetaEvent,
  type SseEvent,
  type ConversationSseRow,
  type ConversationCreatedSsePayload,
  type ConversationUpdatedSsePayload,
  type PlannerResponseSsePayload,
  type ToolInvocationEndSsePayload,
  type ToolInvocationStartSsePayload,
} from "../../../backend/src/types/sse";

export {
  SseType,
  type SseEventType,
  type SsePayload,
  type SseConversationEvent,
  type SseConversationMetaEvent,
  type SseEvent,
  type ConversationSseRow,
  type ConversationCreatedSsePayload,
  type ConversationUpdatedSsePayload,
  type PlannerResponseSsePayload,
  type ToolInvocationEndSsePayload,
  type ToolInvocationStartSsePayload,
};

export const RUN_SSE_TYPE_VALUES: ReadonlySet<SseEventType> = new Set(Object.values(SseType));

export type ConversationCreatedSseEvent = Extract<
  SseConversationMetaEvent,
  { type: typeof SseType.CONVERSATION_CREATED }
>;
export type ConversationUpdatedSseEvent = Extract<
  SseConversationMetaEvent,
  { type: typeof SseType.CONVERSATION_UPDATED }
>;
export type PlannerResponseSseEvent = Extract<
  SseConversationEvent,
  { type: typeof SseType.PLANNER_RESPONSE }
>;
export type ToolInvocationStartSseEvent = Extract<
  SseConversationEvent,
  { type: typeof SseType.TOOL_INVOCATION_START }
>;
export type ToolInvocationEndSseEvent = Extract<
  SseConversationEvent,
  { type: typeof SseType.TOOL_INVOCATION_END }
>;

export {
  isSseEvent,
  parseSseEvent,
  parseSseEventObject,
  sseEventType,
} from "./parseSseEventObject";
