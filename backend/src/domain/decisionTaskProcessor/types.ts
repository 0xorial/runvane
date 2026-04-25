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
import type { parseAgenticPlannerOutput } from "../continueConversationPlannerProtocol.js";

export type EnqueueRunToolInput = {
  conversationId: string;
  sourceEntryId?: string;
  agentId: string | null;
  toolName: string;
  params: unknown;
  toolRequest?: string;
  agentToolConfig?: {
    enabled?: boolean;
    policy?: ToolPermission;
    rules?: Record<string, unknown>;
  };
};

export type ExecuteRunToolResult =
  | {
      kind: "skipped";
    }
  | {
      kind: "completed";
      toolEntryId: string;
    }
  | {
      kind: "blocked";
      toolEntryId: string;
    };

export type DecisionProcessorDeps = {
  chatEntries: ChatEntriesRepo;
  conversations: ConversationsRepo;
  hub: ConversationEventHub;
  llmProviderSettings: LlmProviderSettingsRepo;
  modelPresets: ModelPresetsRepo;
  agents: AgentsRepo;
  uploads: UploadsRepo;
  tools: ToolRegistry;
  executeRunTool: (input: EnqueueRunToolInput, opts?: { shouldCancel?: () => boolean }) => Promise<ExecuteRunToolResult>;
};

export type LlmOverrides = {
  llmProviderId?: string;
  llmModel?: string;
};

export type ParsedDecisionResponse = ReturnType<typeof parseAgenticPlannerOutput>;
export type DecisionFollowup = ParsedDecisionResponse["output"]["followup"];

export type ToolConfig = {
  enabled: boolean;
  policy: ToolPermission;
  rules?: Record<string, unknown>;
};

export type RequestedToolCall = {
  toolName: string;
  toolRequest: string;
};

export type DecisionLlmSuccess = {
  kind: "ok";
  plannerEntryId: string;
  thoughtActionEntryId: string;
  assistantEntryId: string | null;
  reply: string;
  streamedAnswer: string;
  plannerTokenUsage: StreamTextCompletionResult["usage"];
  requestStartedMs: number;
};

export type DecisionLlmCancelled = {
  kind: "cancelled";
};

export type DecisionLlmResult = DecisionLlmSuccess | DecisionLlmCancelled;

export type FinalizeDecisionResultInput = {
  conversationId: string;
  plannerEntryId: string;
  thoughtActionEntryId?: string | null;
  llmRequest: string;
  llmResponse: string;
  streamedAnswer: string;
  enabledToolIds: string[];
  plannerLlmModel?: string;
  requestStartedMs: number;
  parsedLlmResponse: ParsedDecisionResponse;
  assistantEntryId?: string | null;
  plannerTokenUsage?: StreamTextCompletionResult["usage"];
  completionSummaryFallback: string;
};

export type FinalizeDecisionResultOutput = {
  queuedToolCalls: number;
  followup: DecisionFollowup;
  requestedToolCalls: RequestedToolCall[];
};
