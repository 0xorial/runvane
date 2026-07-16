import type { ChatEntry, ThoughtEntry } from "../../../backend/src/contracts/chatEntry.js";

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
  ThoughtEntry,
  ThoughtForkPoint,
  ThoughtStage,
  ThoughtType,
  ToolInvocationEntry,
  ToolState,
  UserMessageEntry,
} from "../../../backend/src/contracts/chatEntry.js";

export type { KnowledgeOverride, RetrievalHit, RetrievalQuery } from "../../../backend/src/contracts/retrieval.js";

export type {
  AgentPreinjectConfig,
  PreinjectedFileRecord,
  PreinjectFileStatus,
  PreinjectFileType,
  PreinjectMode,
  PreinjectPreviewFile,
  PreinjectPreviewResult,
} from "../../../backend/src/contracts/preinject.js";
export { PREINJECT_FILE_TYPES, SCANNED_PREINJECT_TYPES } from "../../../backend/src/contracts/preinject.js";

export function isPlannerThinkingEntry(e: ChatEntry): e is ThoughtEntry {
  return e.type === "thought" && e.thoughtType === "planner";
}

export function isThoughtEntry(e: ChatEntry): e is ThoughtEntry {
  return e.type === "thought";
}
