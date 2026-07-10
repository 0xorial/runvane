import type { ChatEntry, ThoughtStreamEntry } from "../../../backend/src/contracts/chatEntry.js";

export type {
  AssistantMessageEntry,
  AttachmentMode,
  ChatAttachment,
  ChatEntry,
  CheckpointSummaryEntry,
  ContextInjectionEntry,
  LlmDecision,
  LlmDecisionTool,
  LlmDecisionUserResponse,
  RetrievalEntry,
  ThoughtActionEntry,
  ThoughtPrepareEntry,
  ThoughtStreamEntry,
  ThoughtType,
  ToolInvocationEntry,
  ToolState,
  UserMessageEntry,
} from "../../../backend/src/contracts/chatEntry.js";

export type { RagOverride, RetrievalHit, RetrievalQuery } from "../../../backend/src/contracts/retrieval.js";

export type {
  AgentPreinjectConfig,
  PreinjectedFileRecord,
  PreinjectFileStatus,
  PreinjectFileType,
  PreinjectMode,
} from "../../../backend/src/contracts/preinject.js";
export { PREINJECT_FILE_TYPES } from "../../../backend/src/contracts/preinject.js";

export function isPlannerThinkingEntry(e: ChatEntry): e is ThoughtStreamEntry {
  return e.type === "thought_stream" && e.thoughtType === "planner";
}

export function isThoughtStreamEntry(e: ChatEntry): e is ThoughtStreamEntry {
  return e.type === "thought_stream";
}
