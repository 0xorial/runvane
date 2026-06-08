import type {
  ChatEntry,
  GuardrailLlmStreamEntry,
  PlannerLlmStreamEntry,
  SummarizeAttachmentLlmStreamEntry,
  SummarizeLlmStreamEntry,
  TitleLlmStreamEntry,
  ToolParamsLlmStreamEntry,
} from "../../../backend/src/contracts/chatEntry.js";

export type {
  AssistantMessageEntry,
  AttachmentMode,
  ChatAttachment,
  ChatEntry,
  CheckpointSummaryEntry,
  GuardrailLlmStreamEntry,
  LlmDecision,
  LlmDecisionTool,
  LlmDecisionUserResponse,
  PlannerLlmStreamEntry,
  SummarizeAttachmentLlmStreamEntry,
  SummarizeLlmStreamEntry,
  ThoughtActionEntry,
  ThoughtPrepareEntry,
  TitleLlmStreamEntry,
  ToolInvocationEntry,
  ToolParamsLlmStreamEntry,
  ToolState,
  UserMessageEntry,
} from "../../../backend/src/contracts/chatEntry.js";

export type ThoughtStreamEntry =
  | PlannerLlmStreamEntry
  | TitleLlmStreamEntry
  | ToolParamsLlmStreamEntry
  | SummarizeLlmStreamEntry
  | SummarizeAttachmentLlmStreamEntry
  | GuardrailLlmStreamEntry;

export function isPlannerThinkingEntry(e: ChatEntry): e is PlannerLlmStreamEntry {
  return e.type === "planner_llm_stream";
}

export function isThoughtStreamEntry(e: ChatEntry): e is ThoughtStreamEntry {
  return (
    e.type === "planner_llm_stream" ||
    e.type === "title_llm_stream" ||
    e.type === "tool_params_llm_stream" ||
    e.type === "summarize_llm_stream" ||
    e.type === "summarize_attachment_llm_stream" ||
    e.type === "guardrail_llm_stream"
  );
}
