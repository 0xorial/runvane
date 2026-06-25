import type { ChatEntry, ThoughtStreamEntry } from "../../../backend/src/contracts/chatEntry.js";

export type {
  AssistantMessageEntry,
  AttachmentMode,
  ChatAttachment,
  ChatEntry,
  CheckpointSummaryEntry,
  LlmDecision,
  LlmDecisionTool,
  LlmDecisionUserResponse,
  ThoughtActionEntry,
  ThoughtPrepareEntry,
  ThoughtStreamEntry,
  ThoughtType,
  ToolInvocationEntry,
  ToolState,
  UserMessageEntry,
} from "../../../backend/src/contracts/chatEntry.js";

export function isPlannerThinkingEntry(e: ChatEntry): e is ThoughtStreamEntry {
  return e.type === "thought_stream" && e.thoughtType === "planner";
}

export function isThoughtStreamEntry(e: ChatEntry): e is ThoughtStreamEntry {
  return e.type === "thought_stream";
}
