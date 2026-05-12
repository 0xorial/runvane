import type { ChatEntry, PlannerLlmStreamEntry } from "../../../backend3/src/contracts/chatEntry.js";

export type {
  AssistantMessageEntry,
  ChatAttachment,
  ChatEntry,
  LlmDecision,
  LlmDecisionTool,
  LlmDecisionUserResponse,
  PlannerLlmStreamEntry,
  ThoughtActionEntry,
  ThoughtPrepareEntry,
  TitleLlmStreamEntry,
  ToolInvocationEntry,
  UserMessageEntry,
} from "../../../backend3/src/contracts/chatEntry.js";

export function isPlannerThinkingEntry(e: ChatEntry): e is PlannerLlmStreamEntry {
  return e.type === "planner_llm_stream";
}
