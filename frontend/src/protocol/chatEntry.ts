import type {
  ChatEntry,
  PlannerLlmStreamEntry,
  SummarizeLlmStreamEntry,
  TitleLlmStreamEntry,
  ToolParamsLlmStreamEntry,
} from "../../../backend3/src/contracts/chatEntry.js";

export type {
  AssistantMessageEntry,
  ChatAttachment,
  ChatEntry,
  CheckpointSummaryEntry,
  LlmDecision,
  LlmDecisionTool,
  LlmDecisionUserResponse,
  PlannerLlmStreamEntry,
  SummarizeLlmStreamEntry,
  ThoughtActionEntry,
  ThoughtPrepareEntry,
  TitleLlmStreamEntry,
  ToolInvocationEntry,
  ToolParamsLlmStreamEntry,
  UserMessageEntry,
} from "../../../backend3/src/contracts/chatEntry.js";

export type ThoughtStreamEntry =
  | PlannerLlmStreamEntry
  | TitleLlmStreamEntry
  | ToolParamsLlmStreamEntry
  | SummarizeLlmStreamEntry;

export function isPlannerThinkingEntry(e: ChatEntry): e is PlannerLlmStreamEntry {
  return e.type === "planner_llm_stream";
}

export function isThoughtStreamEntry(e: ChatEntry): e is ThoughtStreamEntry {
  return (
    e.type === "planner_llm_stream" ||
    e.type === "title_llm_stream" ||
    e.type === "tool_params_llm_stream" ||
    e.type === "summarize_llm_stream"
  );
}
