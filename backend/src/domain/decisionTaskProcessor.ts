import { logger } from "../infra/logger.js";
import type { ContinueConversationTask } from "./agentTask.js";
import { buildPlannerPrompt, parseAgenticPlannerOutput } from "./continueConversationPlannerProtocol.js";
import { throwIfCancelled } from "./taskCancellation.js";
import { getDecisionLlmResponse, publishDecisionThoughtDelta } from "./decisionTaskProcessor/decisionStreaming.js";
import { finalizeParsedDecisionResult, persistDecisionParseFailure } from "./decisionTaskProcessor/decisionResult.js";
import {
  agentToolConfigFor,
  buildInputFiles,
  enabledToolIdsForAgent,
  lineageEntries,
  priorToolResultsFromEntries,
  resolvePlannerProviderId,
  resolveLlmOverrides,
  resolvePlannerModel,
  resolveRequestParams,
} from "./decisionTaskProcessor/context.js";
import type {
  DecisionProcessorDeps,
  FinalizeDecisionResultOutput,
  ParsedDecisionResponse,
} from "./decisionTaskProcessor/types.js";
import type { ChatEntry, PlannerLlmStreamEntry, UserMessageEntry } from "../types/chatEntry.js";
import { startThoughtLifecycle } from "./thoughtLifecycle.js";
import { SseType } from "../types/sse.js";
import type { AgentsRepo } from "../infra/repositories/agentsRepo.js";
import type { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import type { ConversationsRepo } from "../infra/repositories/conversationsRepo.js";
import type { LlmProviderSettingsRepo } from "../infra/repositories/llmProviderSettingsRepo.js";
import type { ModelPresetsRepo } from "../infra/repositories/modelPresetsRepo.js";
import type { UploadsRepo } from "../infra/repositories/uploadsRepo.js";
import type { ConversationEventHub } from "../events/conversationEventHub.js";
import type { ToolRegistry } from "../tools/toolRegistry.js";
import { initiateThought } from "./thoughtProcessing/index.js";
import type { ToolParamsPrepareSeed, ToolParamsThought } from "./thoughtProcessing/thoughtTypeProviders/toolParamsProvider.js";

type PlannerRunCompletion = {
  plannerEntryId: string;
  thoughtActionEntryId?: string | null;
  llmRequest: string;
  llmResponse: string;
  streamedAnswer: string;
  plannerLlmProviderId?: string;
  plannerLlmModel?: string;
  requestStartedMs: number;
  assistantEntryId?: string | null;
  plannerTokenUsage?: { promptTokens: number; completionTokens: number; cachedPromptTokens?: number };
};

type PlannerRunResult =
  | {
      kind: "cancelled";
      plannerEntryId: string;
    }
  | {
      kind: "ok";
      llmResponse: Extract<Awaited<ReturnType<typeof getDecisionLlmResponse>>, { kind: "ok" }>;
      finalized: FinalizeDecisionResultOutput;
    };

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
    };
  }

  async reprocessPlannerReason(input: {
    conversationId: string;
    sourceEntryId: string;
    editedResponse: string;
  }): Promise<{ plannerEntryId: string; queuedToolCalls: number }> {
    const ctx = this.loadReprocessContext(input.conversationId, input.sourceEntryId);
    const editedResponse = String(input.editedResponse ?? "").trim();
    if (editedResponse.length === 0) {
      throw new Error("editedResponse is required");
    }
    return this.reprocessEditedReason(ctx, editedResponse);
  }

  async reprocessPlannerContext(input: {
    conversationId: string;
    sourceEntryId: string;
    editedRequestText: string;
    llmProviderId: string;
    llmModel: string;
  }): Promise<{ plannerEntryId: string; queuedToolCalls: number }> {
    const ctx = this.loadReprocessContext(input.conversationId, input.sourceEntryId);
    const editedRequestText = String(input.editedRequestText ?? "").trim();
    const llmProviderId = String(input.llmProviderId ?? "").trim();
    const llmModel = String(input.llmModel ?? "").trim();
    if (editedRequestText.length === 0) {
      throw new Error("editedRequestText is required");
    }
    if (!llmProviderId || !llmModel) {
      throw new Error("llmProviderId and llmModel are required");
    }
    return this.reprocessEditedContext(ctx, { editedRequestText, llmProviderId, llmModel });
  }

  async process(task: ContinueConversationTask, opts?: { shouldCancel?: () => boolean }): Promise<void> {
    let triggerEntryId = task.sourceEntryId;
    for (;;) {
      if (triggerEntryId && !this.deps.chatEntries.isEntryOnActiveLineage(task.conversationId, triggerEntryId)) {
        logger.info(
          { conversationId: task.conversationId, sourceEntryId: triggerEntryId },
          "[task] skipped continue_conversation: source entry not on active lineage"
        );
        return;
      }
      throwIfCancelled(opts?.shouldCancel);

      const entries = this.deps.chatEntries.listMessages(task.conversationId);
      const triggerEntry = entries.at(-1) ?? null;
      logger.info(
        { conversationId: task.conversationId, triggerEntryType: triggerEntry?.type ?? null },
        "[task] continue_conversation started"
      );
      const anchorUserMessage = this.findLastUserMessage(entries);
      if (!anchorUserMessage) {
        logger.warn(
          { conversationId: task.conversationId, triggerEntryType: triggerEntry?.type ?? null },
          "[task] skipped continue_conversation: no user message"
        );
        return;
      }

      const llmOverrides = resolveLlmOverrides(this.deps, anchorUserMessage);
      const selectedAgent = this.deps.agents.get(anchorUserMessage.agentId);
      const effectiveModelPresetId = anchorUserMessage.modelPresetId ?? selectedAgent?.default_model_preset_id ?? null;
      const plannerLlmModel = resolvePlannerModel(this.deps, llmOverrides);
      const plannerLlmProviderId = resolvePlannerProviderId(this.deps, llmOverrides);
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
      const plannerRun = await this.runPlannerStep({
        conversationId: task.conversationId,
        parentId: triggerEntry?.id ?? null,
        llmRequest,
        llmProviderId: plannerLlmProviderId,
        llmModel: plannerLlmModel,
        enabledToolIds,
        requestParams,
        inputFiles,
        completionSummaryFallback: "planner step completed",
        parseErrorPrefix: "failed to parse planner response",
        shouldCancel: opts?.shouldCancel,
      });
      if (plannerRun.kind === "cancelled") return;
      const { llmResponse, finalized } = plannerRun;
      throwIfCancelled(opts?.shouldCancel);

      if (finalized.requestedToolCalls.length === 0) {
        if (finalized.followup !== "continue") {
          logger.info({ conversationId: task.conversationId }, "[task] continue_conversation completed");
          return;
        }
        logger.warn(
          { conversationId: task.conversationId, followup: finalized.followup },
          "[task] planner requested followup without tool call; waiting for next continuation trigger"
        );
        return;
      }

      const continuationAnchorId =
        llmResponse.assistantEntryId ?? llmResponse.thoughtActionEntryId ?? llmResponse.plannerEntryId;
      for (const requestedCall of finalized.requestedToolCalls) {
        const tool = this.deps.tools.get(requestedCall.toolName);
        if (!tool) {
          throw new Error(`tool request references missing tool: ${requestedCall.toolName}`);
        }
        await initiateThought<ToolParamsPrepareSeed, ToolParamsThought>({
          thoughtType: "toolParams",
          thought: {
            thoughtId: crypto.randomUUID(),
            conversationId: task.conversationId,
            streamEntryId: "",
          },
          seed: {
            conversationId: task.conversationId,
            sourceEntryId: continuationAnchorId,
            agentId: anchorUserMessage.agentId,
            toolName: requestedCall.toolName,
            toolAiDescription: tool.getAiDescription(),
            toolParamsSchema: tool.getParamsSchema(),
            toolRequest: requestedCall.toolRequest,
            agentToolConfig: agentToolConfigFor(this.deps, anchorUserMessage.agentId, requestedCall.toolName),
            plannerFollowup: {
              mode: finalized.followup,
              userText: anchorUserMessage.text,
              enabledToolIds,
            },
          },
        }, {
          shouldCancel: opts?.shouldCancel,
        });
      }
      logger.info({ conversationId: task.conversationId }, "[task] continue_conversation delegated tool execution");
      return;
    }
  }

  private findLastUserMessage(entries: ChatEntry[]): UserMessageEntry | null {
    return [...entries].reverse().find((entry): entry is UserMessageEntry => entry.type === "user-message") ?? null;
  }

  private loadReprocessContext(
    conversationId: string,
    sourceEntryId: string
  ): {
    conversationId: string;
    sourceEntry: PlannerLlmStreamEntry;
    anchorUserMessage: UserMessageEntry;
    enabledToolIds: string[];
  } {
    const sourceEntry = this.deps.chatEntries.getMessage(conversationId, sourceEntryId);
    if (!sourceEntry || sourceEntry.type !== "planner_llm_stream") {
      throw new Error(`planner thought not found: ${sourceEntryId}`);
    }
    const entries = this.deps.chatEntries.listMessages(conversationId, { activePathOnly: false });
    const lineage = lineageEntries(entries, sourceEntry.id);
    const anchorUserMessage = this.findLastUserMessage(lineage);
    if (!anchorUserMessage) {
      throw new Error(`cannot reprocess thought without ancestor user-message: ${sourceEntryId}`);
    }
    return {
      conversationId,
      sourceEntry,
      anchorUserMessage,
      enabledToolIds: enabledToolIdsForAgent(this.deps, anchorUserMessage.agentId),
    };
  }

  private publishPlannerStarting(conversationId: string, plannerEntry: PlannerLlmStreamEntry): void {
    const { id: chatEntryId, llmRequest: requestText, ...entry } = plannerEntry;
    this.deps.hub.publish(conversationId, {
      ...entry,
      type: SseType.PLANNER_STARTING,
      chatEntryId,
      requestText,
    });
  }

  private reprocessEditedReason(
    ctx: {
      conversationId: string;
      sourceEntry: PlannerLlmStreamEntry;
      enabledToolIds: string[];
    },
    editedResponse: string
  ): { plannerEntryId: string; queuedToolCalls: number } {
    const { sourceEntry } = ctx;
    const plannerEntry = this.deps.chatEntries.appendPlannerLlmStreamEntry(ctx.conversationId, {
      id: crypto.randomUUID(),
      thoughtId: sourceEntry.thoughtId,
      createdAt: new Date().toISOString(),
      parentId: sourceEntry.parentId,
      llmRequest: sourceEntry.llmRequest,
      llmProviderId: sourceEntry.llmProviderId,
      llmResponse: "",
      thoughtMs: null,
      decision: null,
      status: "running",
      llmModel: sourceEntry.llmModel,
    });
    this.publishPlannerStarting(ctx.conversationId, plannerEntry);
    publishDecisionThoughtDelta(this.deps, {
      conversationId: ctx.conversationId,
      plannerEntryId: plannerEntry.id,
      delta: editedResponse,
    });
    const finalized = this.parseAndFinalizeDecisionResult({
      conversationId: ctx.conversationId,
      completion: this.buildCompletionFromReplayEntry(plannerEntry, editedResponse),
      enabledToolIds: ctx.enabledToolIds,
      completionSummaryFallback: "reprocessed planner step completed",
      parseErrorPrefix: "failed to parse edited planner response",
    });
    return { plannerEntryId: plannerEntry.id, queuedToolCalls: finalized.queuedToolCalls };
  }

  private async reprocessEditedContext(
    ctx: {
      conversationId: string;
      sourceEntry: PlannerLlmStreamEntry;
      anchorUserMessage: UserMessageEntry;
      enabledToolIds: string[];
    },
    input: { editedRequestText: string; llmProviderId: string; llmModel: string }
  ): Promise<{ plannerEntryId: string; queuedToolCalls: number }> {
    const selectedAgent = this.deps.agents.get(ctx.anchorUserMessage.agentId);
    const effectiveModelPresetId =
      ctx.anchorUserMessage.modelPresetId ?? selectedAgent?.default_model_preset_id ?? null;
    const requestParams = resolveRequestParams(this.deps, { modelPresetId: effectiveModelPresetId });
    const inputFiles = buildInputFiles(this.deps, ctx.anchorUserMessage);
    const previousPrepareEntry =
      ctx.sourceEntry.parentId != null
        ? this.deps.chatEntries.getMessage(ctx.conversationId, ctx.sourceEntry.parentId)
        : null;
    const prepareParentId =
      previousPrepareEntry && previousPrepareEntry.type === "thought-prepare"
        ? previousPrepareEntry.parentId
        : ctx.sourceEntry.parentId;
    const plannerRun = await this.runPlannerStep({
      conversationId: ctx.conversationId,
      parentId: prepareParentId,
      llmRequest: input.editedRequestText,
      llmProviderId: input.llmProviderId,
      llmModel: input.llmModel,
      enabledToolIds: ctx.enabledToolIds,
      requestParams,
      inputFiles,
      completionSummaryFallback: "reprocessed context completed",
      parseErrorPrefix: "failed to parse reprocessed context response",
    });
    if (plannerRun.kind === "cancelled") {
      return { plannerEntryId: plannerRun.plannerEntryId, queuedToolCalls: 0 };
    }
    return {
      plannerEntryId: plannerRun.llmResponse.plannerEntryId,
      queuedToolCalls: plannerRun.finalized.queuedToolCalls,
    };
  }

  private buildCompletionFromReplayEntry(
    plannerEntry: PlannerLlmStreamEntry,
    editedResponse: string
  ): PlannerRunCompletion {
    return {
      plannerEntryId: plannerEntry.id,
      llmRequest: plannerEntry.llmRequest,
      llmResponse: editedResponse,
      streamedAnswer: editedResponse,
      plannerLlmProviderId: plannerEntry.llmProviderId,
      plannerLlmModel: plannerEntry.llmModel,
      requestStartedMs: Date.parse(plannerEntry.createdAt),
    };
  }

  private buildCompletionFromLlmResult(input: {
    llmRequest: string;
    llmResponse: Extract<Awaited<ReturnType<typeof getDecisionLlmResponse>>, { kind: "ok" }>;
    llmProviderId: string;
    llmModel: string;
  }): PlannerRunCompletion {
    const { kind: _kind, reply: llmResponse, ...responseBase } = input.llmResponse;
    return {
      llmRequest: input.llmRequest,
      llmResponse,
      plannerLlmProviderId: input.llmProviderId,
      plannerLlmModel: input.llmModel,
      ...responseBase,
    };
  }

  private async runPlannerStep(input: {
    conversationId: string;
    parentId?: string | null;
    llmRequest: string;
    llmProviderId?: string;
    llmModel?: string;
    enabledToolIds: string[];
    requestParams: Record<string, unknown>;
    inputFiles: Array<{ filename: string; mimeType: string; base64Data: string }>;
    completionSummaryFallback: string;
    parseErrorPrefix: string;
    shouldCancel?: () => boolean;
  }): Promise<PlannerRunResult> {
    const thought = startThoughtLifecycle(this.deps, {
      conversationId: input.conversationId,
      parentId: input.parentId,
      llmRequest: input.llmRequest,
      llmProviderId: input.llmProviderId,
      llmModel: input.llmModel,
      kind: "planner",
      includeAction: true,
      summary: "Call preparation",
    });
    const requestStartedMs = Date.parse(thought.streamEntry.createdAt);
    const llmResponse = await getDecisionLlmResponse(this.deps, {
      conversationId: input.conversationId,
      plannerEntryId: thought.streamEntry.id,
      thoughtActionEntryId: thought.thoughtActionEntry.id,
      requestStartedMs,
      requestText: input.llmRequest,
      plannerLlmModel: input.llmModel ?? "",
      llmOverrides: {
        llmProviderId: input.llmProviderId,
        llmModel: input.llmModel,
      },
      requestParams: input.requestParams,
      files: input.inputFiles,
      shouldCancel: input.shouldCancel,
    });
    if (llmResponse.kind === "cancelled") {
      return { kind: "cancelled", plannerEntryId: thought.streamEntry.id };
    }
    const finalized = this.parseAndFinalizeDecisionResult({
      conversationId: input.conversationId,
      completion: this.buildCompletionFromLlmResult({
        llmRequest: input.llmRequest,
        llmResponse,
        llmProviderId: input.llmProviderId ?? "",
        llmModel: input.llmModel ?? "",
      }),
      enabledToolIds: input.enabledToolIds,
      completionSummaryFallback: input.completionSummaryFallback,
      parseErrorPrefix: input.parseErrorPrefix,
    });
    return { kind: "ok", llmResponse, finalized };
  }

  private parseAndFinalizeDecisionResult(input: {
    conversationId: string;
    completion: PlannerRunCompletion;
    enabledToolIds: string[];
    completionSummaryFallback: string;
    parseErrorPrefix: string;
  }) {
    const completion = input.completion;
    let parsedLlmResponse: ParsedDecisionResponse;
    try {
      parsedLlmResponse = parseAgenticPlannerOutput({
        reply: completion.llmResponse,
        streamedAnswer: completion.streamedAnswer,
        isToolAvailable: (toolId) => input.enabledToolIds.includes(toolId),
      });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      persistDecisionParseFailure(this.deps, {
        conversationId: input.conversationId,
        ...completion,
        detail,
      });
      throw new Error(`${input.parseErrorPrefix}: ${detail}`, { cause: e });
    }
    return finalizeParsedDecisionResult(this.deps, {
      conversationId: input.conversationId,
      ...completion,
      enabledToolIds: input.enabledToolIds,
      parsedLlmResponse,
      completionSummaryFallback: input.completionSummaryFallback,
    });
  }
}
