import { logger } from "../infra/logger.js";
import type { ContinueConversationTask } from "./agentTask.js";
import { buildPlannerPrompt, parseAgenticPlannerOutput } from "./continueConversationPlannerProtocol.js";
import { throwIfCancelled } from "./taskCancellation.js";
import {
  appendDecisionEntryAndPublishStart,
  getDecisionLlmResponse,
  publishDecisionThoughtDelta,
} from "./decisionTaskProcessor/decisionStreaming.js";
import {
  finalizeParsedDecisionResult,
  persistDecisionParseFailure,
} from "./decisionTaskProcessor/decisionResult.js";
import {
  buildInputFiles,
  enabledToolIdsForAgent,
  lineageEntries,
  priorToolResultsFromEntries,
  resolveLlmOverrides,
  resolvePlannerModel,
  resolveRequestParams,
} from "./decisionTaskProcessor/context.js";
import type { DecisionProcessorDeps, ParsedDecisionResponse } from "./decisionTaskProcessor/types.js";
import type { ChatEntry, UserMessageEntry } from "../types/chatEntry.js";
import type { AgentsRepo } from "../infra/repositories/agentsRepo.js";
import type { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import type { ConversationsRepo } from "../infra/repositories/conversationsRepo.js";
import type { LlmProviderSettingsRepo } from "../infra/repositories/llmProviderSettingsRepo.js";
import type { ModelPresetsRepo } from "../infra/repositories/modelPresetsRepo.js";
import type { UploadsRepo } from "../infra/repositories/uploadsRepo.js";
import type { ConversationEventHub } from "../events/conversationEventHub.js";
import type { ToolRegistry } from "../tools/toolRegistry.js";

export class DecisionTaskProcessor {
  private readonly deps: DecisionProcessorDeps;

  constructor(
    chatEntries: ChatEntriesRepo,
    conversations: ConversationsRepo,
    hub: ConversationEventHub,
    llmProviderSettings: LlmProviderSettingsRepo,
    modelPresets: ModelPresetsRepo,
    agents: AgentsRepo,
    uploads: UploadsRepo,
    tools: ToolRegistry,
    enqueueRunTool: DecisionProcessorDeps["enqueueRunTool"],
  ) {
    this.deps = {
      chatEntries,
      conversations,
      hub,
      llmProviderSettings,
      modelPresets,
      agents,
      uploads,
      tools,
      enqueueRunTool,
    };
  }

  async reprocessPlannerThought(input: {
    conversationId: string;
    sourceEntryId: string;
    editedResponse: string;
  }): Promise<{ plannerEntryId: string; queuedToolCalls: number }> {
    const sourceEntry = this.deps.chatEntries.getMessage(input.conversationId, input.sourceEntryId);
    if (!sourceEntry || sourceEntry.type !== "planner_llm_stream") {
      throw new Error(`planner thought not found: ${input.sourceEntryId}`);
    }

    const entries = this.deps.chatEntries.listMessages(input.conversationId, { activePathOnly: false });
    const lineage = lineageEntries(entries, sourceEntry.id);
    const anchorUserMessage = this.findLastUserMessage(lineage);
    if (!anchorUserMessage) {
      throw new Error(`cannot reprocess thought without ancestor user-message: ${input.sourceEntryId}`);
    }

    const plannerEntry = appendDecisionEntryAndPublishStart(this.deps, {
      conversationId: input.conversationId,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      parentId: sourceEntry.parentId,
      llmRequest: sourceEntry.llmRequest,
      llmModel: sourceEntry.llmModel,
    });
    publishDecisionThoughtDelta(this.deps, {
      conversationId: input.conversationId,
      plannerEntryId: plannerEntry.id,
      delta: input.editedResponse.trim() ? input.editedResponse : "",
    });

    const finalized = this.parseAndFinalizeDecisionResult({
      conversationId: input.conversationId,
      plannerEntryId: plannerEntry.id,
      llmRequest: plannerEntry.llmRequest,
      llmResponse: input.editedResponse,
      streamedAnswer: input.editedResponse,
      enabledToolIds: enabledToolIdsForAgent(this.deps, anchorUserMessage.agentId),
      plannerLlmModel: plannerEntry.llmModel,
      requestStartedMs: Date.parse(plannerEntry.createdAt),
      anchorUserMessage,
      completionSummaryFallback: "reprocessed planner step completed",
      parseErrorPrefix: "failed to parse edited planner response",
    });
    return { plannerEntryId: plannerEntry.id, queuedToolCalls: finalized.queuedToolCalls };
  }

  async process(task: ContinueConversationTask, opts?: { shouldCancel?: () => boolean }): Promise<void> {
    if (task.sourceEntryId && !this.deps.chatEntries.isEntryOnActiveLineage(task.conversationId, task.sourceEntryId)) {
      logger.info(
        { conversationId: task.conversationId, sourceEntryId: task.sourceEntryId },
        "[task] skipped continue_conversation: source entry not on active lineage",
      );
      return;
    }
    throwIfCancelled(opts?.shouldCancel);

    const entries = this.deps.chatEntries.listMessages(task.conversationId);
    const triggerEntry = entries.at(-1) ?? null;
    logger.info({ conversationId: task.conversationId, triggerEntryType: triggerEntry?.type ?? null }, "[task] continue_conversation started");
    const anchorUserMessage = this.findLastUserMessage(entries);
    if (!anchorUserMessage) {
      logger.warn(
        { conversationId: task.conversationId, triggerEntryType: triggerEntry?.type ?? null },
        "[task] skipped continue_conversation: no user message",
      );
      return;
    }

    const llmOverrides = resolveLlmOverrides(this.deps, anchorUserMessage);
    const selectedAgent = this.deps.agents.get(anchorUserMessage.agentId);
    const effectiveModelPresetId = anchorUserMessage.modelPresetId ?? selectedAgent?.default_model_preset_id ?? null;
    const plannerLlmModel = resolvePlannerModel(this.deps, llmOverrides);
    const requestParams = resolveRequestParams(this.deps, { modelPresetId: effectiveModelPresetId });
    const inputFiles = buildInputFiles(this.deps, anchorUserMessage);
    const enabledToolIds = enabledToolIdsForAgent(this.deps, anchorUserMessage.agentId);

    const llmRequest = buildPlannerPrompt({
      systemPrompt: this.deps.agents.get(anchorUserMessage.agentId)?.system_prompt ?? "",
      entries,
      anchorUserText: anchorUserMessage.text,
      triggerEntry: triggerEntry,
      toolIds: enabledToolIds,
      priorToolResults: priorToolResultsFromEntries(entries),
    });

    const llmResponse = await getDecisionLlmResponse(this.deps, {
      conversationId: task.conversationId,
      requestText: llmRequest,
      plannerLlmModel,
      llmOverrides,
      requestParams,
      files: inputFiles,
      shouldCancel: opts?.shouldCancel,
    });
    if (llmResponse.kind === "cancelled") return;

    const finalized = this.parseAndFinalizeDecisionResult({
      conversationId: task.conversationId,
      plannerEntryId: llmResponse.plannerEntryId,
      llmRequest,
      llmResponse: llmResponse.reply,
      streamedAnswer: llmResponse.streamedAnswer,
      enabledToolIds,
      plannerLlmModel,
      requestStartedMs: llmResponse.requestStartedMs,
      anchorUserMessage,
      assistantEntryId: llmResponse.assistantEntryId,
      plannerTokenUsage: llmResponse.plannerTokenUsage,
      completionSummaryFallback: "planner step completed",
      parseErrorPrefix: "failed to parse planner response",
    });
    throwIfCancelled(opts?.shouldCancel);
    if (finalized.queuedToolCalls > 0) return;
    if (finalized.followup !== "continue") {
      logger.info({ conversationId: task.conversationId }, "[task] continue_conversation completed");
      return;
    }
    logger.warn(
      { conversationId: task.conversationId, followup: finalized.followup },
      "[task] planner requested followup without tool call; waiting for next continuation trigger",
    );
  }

  private findLastUserMessage(entries: ChatEntry[]): UserMessageEntry | null {
    return [...entries].reverse().find((entry): entry is UserMessageEntry => entry.type === "user-message") ?? null;
  }

  private parseAndFinalizeDecisionResult(input: {
    conversationId: string;
    plannerEntryId: string;
    llmRequest: string;
    llmResponse: string;
    streamedAnswer: string;
    enabledToolIds: string[];
    plannerLlmModel?: string;
    requestStartedMs: number;
    anchorUserMessage: UserMessageEntry;
    assistantEntryId?: string | null;
    plannerTokenUsage?: { promptTokens: number; completionTokens: number; cachedPromptTokens?: number };
    completionSummaryFallback: string;
    parseErrorPrefix: string;
  }) {
    let parsedLlmResponse: ParsedDecisionResponse;
    try {
      parsedLlmResponse = parseAgenticPlannerOutput({
        reply: input.llmResponse,
        streamedAnswer: input.streamedAnswer,
        isToolAvailable: (toolId) => input.enabledToolIds.includes(toolId),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      persistDecisionParseFailure(this.deps, {
        conversationId: input.conversationId,
        plannerEntryId: input.plannerEntryId,
        llmRequest: input.llmRequest,
        llmResponse: input.llmResponse,
        plannerLlmModel: input.plannerLlmModel,
        requestStartedMs: input.requestStartedMs,
        detail,
        plannerTokenUsage: input.plannerTokenUsage,
      });
      throw new Error(`${input.parseErrorPrefix}: ${detail}`, { cause: e });
    }
    return finalizeParsedDecisionResult(this.deps, {
      conversationId: input.conversationId,
      plannerEntryId: input.plannerEntryId,
      llmRequest: input.llmRequest,
      llmResponse: input.llmResponse,
      enabledToolIds: input.enabledToolIds,
      plannerLlmModel: input.plannerLlmModel,
      requestStartedMs: input.requestStartedMs,
      parsedLlmResponse,
      anchorUserMessage: input.anchorUserMessage,
      assistantEntryId: input.assistantEntryId,
      plannerTokenUsage: input.plannerTokenUsage,
      completionSummaryFallback: input.completionSummaryFallback,
    });
  }
}
