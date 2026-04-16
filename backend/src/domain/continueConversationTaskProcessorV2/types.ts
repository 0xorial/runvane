import type { StreamTextCompletionResult } from "../../llm_provider/provider.js";
import type { AgentsRepo } from "../../infra/repositories/agentsRepo.js";
import type { ChatEntriesRepo } from "../../infra/repositories/chatEntriesRepo.js";
import type { ConversationsRepo } from "../../infra/repositories/conversationsRepo.js";
import type { LlmProviderSettingsRepo } from "../../infra/repositories/llmProviderSettingsRepo.js";
import type { ModelPresetsRepo } from "../../infra/repositories/modelPresetsRepo.js";
import type { UploadsRepo } from "../../infra/repositories/uploadsRepo.js";
import type { ConversationEventHub } from "../../events/conversationEventHub.js";
import type { ToolPermission } from "../../tools/baseTool.js";
import type { ToolRegistry } from "../../tools/toolRegistry.js";
import type { UserMessageEntry } from "../../types/chatEntry.js";
import type { parseAgenticPlannerOutput } from "../continueConversationPlannerProtocol.js";

export type EnqueueRunToolInput = {
  conversationId: string;
  sourceEntryId?: string;
  agentId: string | null;
  toolName: string;
  params: unknown;
  toolRequest?: string;
  batchId?: string;
  agentToolConfig?: {
    enabled?: boolean;
    policy?: ToolPermission;
    rules?: Record<string, unknown>;
  };
};

export type ContinueConversationProcessorDeps = {
  chatEntries: ChatEntriesRepo;
  conversations: ConversationsRepo;
  hub: ConversationEventHub;
  llmProviderSettings: LlmProviderSettingsRepo;
  modelPresets: ModelPresetsRepo;
  agents: AgentsRepo;
  uploads: UploadsRepo;
  tools: ToolRegistry;
  enqueueRunTool: (input: EnqueueRunToolInput) => { taskId: number };
};

export type LlmOverrides = {
  llmProviderId?: string;
  llmModel?: string;
};

export type ParsedPlannerResponse = ReturnType<typeof parseAgenticPlannerOutput>;
export type PlannerFollowup = ParsedPlannerResponse["output"]["followup"];

export type ToolConfig = {
  enabled: boolean;
  policy: ToolPermission;
  rules?: Record<string, unknown>;
};

export type PlannerLlmSuccess = {
  kind: "ok";
  plannerEntryId: string;
  assistantEntryId: string | null;
  reply: string;
  streamedAnswer: string;
  plannerTokenUsage: StreamTextCompletionResult["usage"];
  requestStartedMs: number;
};

export type PlannerLlmCancelled = {
  kind: "cancelled";
};

export type PlannerLlmResult = PlannerLlmSuccess | PlannerLlmCancelled;

export type FinalizePlannerResultInput = {
  conversationId: string;
  plannerEntryId: string;
  llmRequest: string;
  llmResponse: string;
  enabledToolIds: string[];
  plannerLlmModel?: string;
  requestStartedMs: number;
  parsedLlmResponse: ParsedPlannerResponse;
  anchorUserMessage: UserMessageEntry;
  assistantEntryId?: string | null;
  plannerTokenUsage?: StreamTextCompletionResult["usage"];
  completionSummaryFallback: string;
};

export type FinalizePlannerResultOutput = {
  queuedToolCalls: number;
  followup: PlannerFollowup;
};
