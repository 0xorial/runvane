import { ConversationEventHub } from "../events/conversationEventHub.js";
import { logger } from "../infra/logger.js";
import type { AgentsRepo } from "../infra/repositories/agentsRepo.js";
import { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import { ConversationsRepo } from "../infra/repositories/conversationsRepo.js";
import { LlmProviderSettingsRepo } from "../infra/repositories/llmProviderSettingsRepo.js";
import { ModelPresetsRepo } from "../infra/repositories/modelPresetsRepo.js";
import { UploadsRepo } from "../infra/repositories/uploadsRepo.js";
import type { ContinueConversationTask } from "./agentTask.js";
import type { ToolPermission } from "../tools/baseTool.js";
import { ToolRegistry } from "../tools/toolRegistry.js";
import type { AgenticToolRequest, ChatEntry, UserMessageEntry } from "../types/chatEntry.js";
import { type StreamTextCompletionResult } from "../llm_provider/provider.js";
import { SseType } from "../types/sse.js";
import { TokenUsageMapper } from "../types/tokenUsage.js";
import { usageByConversationId } from "./conversationUsage.js";
import { isTaskCancelledError, throwIfCancelled } from "./taskCancellation.js";
import {
  composeFailedPlannerResponse,
  extractAssistantOutputFromJsonLike,
  incrementalDelta,
  usageFromStreamingError,
} from "./continueConversationTaskProcessor.helpers.js";
import { buildPlannerPrompt, parseAgenticPlannerOutput } from "./continueConversationPlannerProtocol.js";

export class ContinueConversationTaskProcessor {
  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly conversations: ConversationsRepo,
    private readonly hub: ConversationEventHub,
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly modelPresets: ModelPresetsRepo,
    private readonly agents: AgentsRepo,
    private readonly uploads: UploadsRepo,
    private readonly tools: ToolRegistry,
    private readonly enqueueRunTool: (input: {
      conversationId: string;
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
    }) => { taskId: number }
  ) {}

  private publishConversationUpdated(conversationId: string): void {
    const conversation = this.conversations.get(conversationId, {
      includeDeleted: true,
    });
    if (!conversation) return;
    this.hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: {
        id: conversation.id,
        title: conversation.title,
        groupId: conversation.group_id,
        isDeleted: Number(conversation.is_deleted ?? 0) === 1,
        createdAt: conversation.created_at,
        updatedAt: conversation.updated_at,
        promptTokensTotal: conversation.prompt_tokens_total,
        cachedPromptTokensTotal: conversation.cached_prompt_tokens_total,
        completionTokensTotal: conversation.completion_tokens_total,
        tokenUsageByModel:
          usageByConversationId(this.chatEntries.listConversationTokenUsageByModel()).get(conversationId) ?? [],
      },
    });
  }

  private agentToolConfigFor(
    agentId: string,
    toolName: string
  ): {
    enabled: boolean;
    policy: ToolPermission;
    rules?: Record<string, unknown>;
  } {
    const agent = this.agents.get(agentId);
    const toolCfg = agent?.default_llm_configuration?.tools?.[toolName];
    const enabled = toolCfg?.enabled === undefined ? true : toolCfg.enabled === true;
    const policy: ToolPermission = toolCfg?.policy ?? "allow";
    const tool = this.tools.get(toolName);
    const defaultRules =
      tool && typeof tool.getDefaultRules() === "object" && tool.getDefaultRules() != null
        ? (tool.getDefaultRules() as unknown as Record<string, unknown>)
        : {};
    const rules = toolCfg?.rules ?? defaultRules;
    return { enabled, policy, ...(rules ? { rules } : {}) };
  }

  private resolveLlmOverrides(anchorUserMessage: UserMessageEntry): {
    llmProviderId?: string;
    llmModel?: string;
  } {
    const agent = this.agents.get(anchorUserMessage.agentId);

    const llmProviderId =
      anchorUserMessage.llmProviderId ??
      agent?.default_llm_configuration?.provider_id ??
      agent?.model_reference?.provider_id;

    const llmModel =
      anchorUserMessage.llmModel ?? agent?.default_llm_configuration?.model_name ?? agent?.model_reference?.model_name;

    return {
      ...(llmProviderId ? { llmProviderId } : {}),
      ...(llmModel ? { llmModel } : {}),
    };
  }

  private resolvePlannerModel(overrides: { llmModel?: string }): string {
    const doc = this.llmProviderSettings.getDocument();
    return String(overrides.llmModel || doc.llm_configuration.model_name || "gpt-4o-mini");
  }


  private parseStructuredParamValue(key: string, value: unknown): unknown {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return value;

    // Model presets editor stores values as strings; for structured output keys we require valid JSON.
    if (key === "response_format" || key === "json_schema" || key === "schema" || key === "structured_output") {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`invalid JSON for model parameter "${key}": ${msg}`);
      }
    }
    return value;
  }

  private resolveRequestParams(input: { modelPresetId?: number | null }): Record<string, unknown> {
    const doc = this.llmProviderSettings.getDocument();
    const out: Record<string, unknown> = {};
    const globalSettings = doc.llm_configuration.model_settings;
    if (globalSettings && typeof globalSettings === "object" && !Array.isArray(globalSettings)) {
      for (const [key, value] of Object.entries(globalSettings)) {
        out[key] = this.parseStructuredParamValue(key, value);
      }
    }
    if (typeof input.modelPresetId === "number") {
      const preset = this.modelPresets.get(input.modelPresetId);
      if (!preset) {
        throw new Error(`model preset not found: ${input.modelPresetId}`);
      }
      for (const [key, value] of Object.entries(preset.parameters ?? {})) {
        out[key] = this.parseStructuredParamValue(key, value);
      }
    }
    return out;
  }

  private async callLlmStreaming(
    prompt: string,
    overrides: { llmProviderId?: string; llmModel?: string },
    requestParams: Record<string, unknown>,
    files: Array<{
      filename: string;
      mimeType: string;
      base64Data: string;
    }>,
    onDelta: (delta: string) => void
  ): Promise<StreamTextCompletionResult> {
    const doc = this.llmProviderSettings.getDocument();
    const providerId = String(overrides.llmProviderId || doc.llm_configuration.provider_id || "openai");
    const model = this.resolvePlannerModel(overrides);
    const provider = this.llmProviderSettings.getProvider(providerId);
    if (!provider) throw new Error(`unknown provider: ${providerId}`);
    const providerSettings = this.llmProviderSettings.getProviderSettings(providerId);
    if (!providerSettings) throw new Error(`provider settings not found: ${providerId}`);

    logger.info(
      {
        providerId,
        model,
        promptChars: prompt.length,
      },
      "[llm] request formatted"
    );
    logger.info({ providerId, model }, "[llm] sending request");
    const requestSentAtMs = Date.now();
    let firstTokenLogged = false;

    const result = await provider.streamTextCompletion(
      providerSettings,
      {
        model,
        prompt,
        requestParams,
        files,
      },
      (delta) => {
        if (!firstTokenLogged) {
          firstTokenLogged = true;
          logger.info(
            {
              providerId,
              model,
              firstTokenLatencyMs: Math.max(0, Date.now() - requestSentAtMs),
            },
            "[llm] first token received"
          );
        }
        onDelta(delta);
      }
    );
    logger.info(
      {
        providerId,
        model,
        responseChars: result.text.length,
        usage: result.usage ?? null,
      },
      "[llm] completion finished"
    );
    return result;
  }

  private parseRequestedToolCalls(input: {
    requests: AgenticToolRequest[];
    enabledToolIds: string[];
  }): Array<{ toolName: string; toolRequest: string }> {
    if (input.requests.length === 0) return [];
    const out: Array<{ toolName: string; toolRequest: string }> = [];
    const allowedTools = new Set(input.enabledToolIds);
    for (const request of input.requests) {
      const toolName = String(request.tool_name ?? "").trim();
      const toolRequest = String(request.request ?? "").trim();
      if (!toolName || !toolRequest) continue;
      if (!allowedTools.has(toolName)) {
        throw new Error(`tool request references disabled or unknown tool: ${toolName}`);
      }
      out.push({ toolName, toolRequest });
    }
    return out;
  }

  private buildInputFiles(anchorUserMessage: UserMessageEntry): Array<{
    filename: string;
    mimeType: string;
    base64Data: string;
  }> {
    return (anchorUserMessage.attachments ?? []).map((attachment) => {
      const content = this.uploads.readContentById(attachment.id);
      if (!content) {
        throw new Error(`attachment content not found: ${attachment.id}`);
      }
      return {
        filename: attachment.name,
        mimeType: attachment.mimeType || "application/octet-stream",
        base64Data: content.data.toString("base64"),
      };
    });
  }

  private enabledToolIdsForAgent(agentId: string): string[] {
    return this.tools
      .list()
      .filter((tool) => this.agentToolConfigFor(agentId, tool.getName()).enabled)
      .map((tool) => tool.getName());
  }

  private priorToolResultsFromEntries(entries: ChatEntry[]): Array<{
    toolId: string;
    ok: boolean;
    output: unknown;
    error: string | null;
  }> {
    return entries
      .filter((entry): entry is Extract<ChatEntry, { type: "tool-invocation" }> => entry.type === "tool-invocation")
      .slice(-8)
      .map((entry) => {
        const result =
          entry.result && typeof entry.result === "object" && !Array.isArray(entry.result)
            ? (entry.result as Record<string, unknown>)
            : {};
        return {
          toolId: String(result.toolId ?? entry.toolId),
          ok: result.ok === true,
          output: result.output ?? null,
          error: typeof result.error === "string" ? result.error : null,
        };
      });
  }

  private async getPlannerLlmResponse(input: {
    conversationId: string;
    requestText: string;
    plannerLlmModel: string;
    llmOverrides: { llmProviderId?: string; llmModel?: string };
    requestParams: Record<string, unknown>;
    files: Array<{ filename: string; mimeType: string; base64Data: string }>;
    shouldCancel?: () => boolean;
  }): Promise<
    | { kind: "cancelled" }
    | {
        kind: "ok";
        plannerEntryId: string;
        assistantEntryId: string | null;
        reply: string;
        streamedAnswer: string;
        plannerTokenUsage: StreamTextCompletionResult["usage"];
        requestStartedMs: number;
      }
  > {
    const plannerEntryId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const requestStartedMs = Date.now();
    const plannerEntry = this.chatEntries.appendPlannerLlmStreamEntry(input.conversationId, {
      id: plannerEntryId,
      createdAt,
      llmRequest: input.requestText,
      llmResponse: "",
      thoughtMs: null,
      decision: null,
      status: "running",
      llmModel: input.plannerLlmModel,
    });
    this.hub.publish(input.conversationId, {
      type: SseType.PLANNER_STARTING,
      chatEntryId: plannerEntryId,
      conversationIndex: plannerEntry.conversationIndex,
      createdAt: plannerEntry.createdAt,
      requestText: input.requestText,
      llmModel: input.plannerLlmModel,
    });

    let reply = "";
    let firstDeltaPublished = false;
    let plannerText = "";
    let streamedAnswer = "";
    let assistantEntryId: string | null = null;
    let reconstructedReply = "";
    let plannerTokenUsage: StreamTextCompletionResult["usage"];
    try {
      const completion = await this.callLlmStreaming(
        input.requestText,
        input.llmOverrides,
        input.requestParams,
        input.files,
        (delta) => {
          throwIfCancelled(input.shouldCancel);
          if (!firstDeltaPublished) {
            firstDeltaPublished = true;
            logger.info(
              {
                conversationId: input.conversationId,
                plannerEntryId,
                firstStreamLatencyMs: Math.max(0, Date.now() - requestStartedMs),
              },
              "[sse] first llm token streamed"
            );
          }
          reconstructedReply += delta;
          const nextThought = reconstructedReply;
          const thoughtDelta = incrementalDelta(plannerText, nextThought);
          if (thoughtDelta) {
            this.hub.publish(input.conversationId, {
              type: SseType.PLANNER_LLM_STREAM,
              chatEntryId: plannerEntryId,
              delta: thoughtDelta,
            });
          }
          plannerText = nextThought;

          const streamedAssistantOutput = extractAssistantOutputFromJsonLike(reconstructedReply);
          const answerDelta = incrementalDelta(streamedAnswer, streamedAssistantOutput);
          if (answerDelta) {
            if (!assistantEntryId) {
              assistantEntryId = crypto.randomUUID();
              this.chatEntries.appendAssistantMessage(input.conversationId, "", {
                id: assistantEntryId,
              });
            }
            this.hub.publish(input.conversationId, {
              type: SseType.ASSISTANT_STREAM,
              chatEntryId: assistantEntryId,
              delta: answerDelta,
            });
          }
          streamedAnswer = streamedAssistantOutput;
        }
      );
      plannerTokenUsage = completion.usage;
      reply = reconstructedReply || completion.text || "";
    } catch (e) {
      const partialUsage = usageFromStreamingError(e);
      if (partialUsage) {
        plannerTokenUsage = partialUsage;
      }
      if (isTaskCancelledError(e)) {
        const detail = e instanceof Error ? e.message : String(e);
        this.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
          id: plannerEntryId,
          llmRequest: input.requestText,
          llmResponse: composeFailedPlannerResponse(reconstructedReply),
          thoughtMs: Math.max(0, Date.now() - requestStartedMs),
          decision: null,
          status: "cancelled",
          error: detail,
          llmModel: input.plannerLlmModel,
          ...TokenUsageMapper.toEntryFields(plannerTokenUsage),
        });
        this.publishConversationUpdated(input.conversationId);
        this.hub.publish(input.conversationId, {
          type: SseType.PLANNER_RESPONSE,
          chatEntryId: plannerEntryId,
          summary: "Cancelled",
          finished: true,
          action: "cancelled",
          llmModel: input.plannerLlmModel,
          ...TokenUsageMapper.toSseFields(plannerTokenUsage),
        });
        return { kind: "cancelled" };
      }
      const detail = e instanceof Error ? e.message : String(e);
      this.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
        id: plannerEntryId,
        llmRequest: input.requestText,
        llmResponse: composeFailedPlannerResponse(reconstructedReply),
        thoughtMs: Math.max(0, Date.now() - requestStartedMs),
        decision: null,
        status: "failed",
        error: detail,
        llmModel: input.plannerLlmModel,
        ...TokenUsageMapper.toEntryFields(plannerTokenUsage),
      });
      this.publishConversationUpdated(input.conversationId);
      this.hub.publish(input.conversationId, {
        type: SseType.PLANNER_RESPONSE,
        chatEntryId: plannerEntryId,
        summary: detail,
        finished: true,
        action: "failed",
        llmModel: input.plannerLlmModel,
        ...TokenUsageMapper.toSseFields(plannerTokenUsage),
      });
      throw e;
    }

    return {
      kind: "ok",
      plannerEntryId,
      assistantEntryId,
      reply,
      streamedAnswer,
      plannerTokenUsage,
      requestStartedMs,
    };
  }

  async process(task: ContinueConversationTask, opts?: { shouldCancel?: () => boolean }): Promise<void> {
    const conversationId = task.conversationId;
    throwIfCancelled(opts?.shouldCancel);
    const initialEntries = this.chatEntries.listMessages(conversationId);
    const triggerEntry = initialEntries.at(-1) ?? null;
    logger.info(
      { conversationId, triggerEntryType: triggerEntry?.type ?? null },
      "[task] continue_conversation started"
    );
    const anchorUserMessage = [...initialEntries]
      .reverse()
      .find((entry): entry is UserMessageEntry => entry.type === "user-message");
    if (!anchorUserMessage) {
      logger.warn(
        { conversationId, triggerEntryType: triggerEntry?.type ?? null },
        "[task] skipped continue_conversation: no user message"
      );
      return;
    }
    const agent = this.agents.get(anchorUserMessage.agentId);
    const llmOverrides = this.resolveLlmOverrides(anchorUserMessage);
    const selectedAgent = this.agents.get(anchorUserMessage.agentId);
    const effectiveModelPresetId = anchorUserMessage.modelPresetId ?? selectedAgent?.default_model_preset_id ?? null;
    const requestParams = this.resolveRequestParams({ modelPresetId: effectiveModelPresetId });
    const plannerLlmModel = this.resolvePlannerModel(llmOverrides);
    const inputFiles = this.buildInputFiles(anchorUserMessage);
    const enabledToolIds = this.enabledToolIdsForAgent(anchorUserMessage.agentId);
    throwIfCancelled(opts?.shouldCancel);
    const entries = this.chatEntries.listMessages(conversationId);
    const llmRequest = buildPlannerPrompt({
      systemPrompt: agent?.system_prompt ?? "",
      entries,
      anchorUserText: anchorUserMessage.text,
      triggerEntry: entries.at(-1) ?? null,
      toolIds: enabledToolIds,
      priorToolResults: this.priorToolResultsFromEntries(entries),
    });
    const llmResponse = await this.getPlannerLlmResponse({
      conversationId,
      requestText: llmRequest,
      plannerLlmModel,
      llmOverrides,
      requestParams,
      files: inputFiles,
      shouldCancel: opts?.shouldCancel,
    });
    if (llmResponse.kind === "cancelled") return;

    const parsedLlmResponse = parseAgenticPlannerOutput({
      reply: llmResponse.reply,
      streamedAnswer: llmResponse.streamedAnswer,
      isToolAvailable: (toolId) => enabledToolIds.includes(toolId),
    });
    throwIfCancelled(opts?.shouldCancel);
    const decision = parsedLlmResponse.decision;
    const agentic = parsedLlmResponse.output;
    const requestedToolCalls = this.parseRequestedToolCalls({
      requests: agentic.tool_requests,
      enabledToolIds,
    });
    this.chatEntries.updatePlannerLlmStreamEntry(conversationId, {
      id: llmResponse.plannerEntryId,
      llmRequest: llmRequest,
      llmResponse: llmResponse.reply,
      thoughtMs: Math.max(0, Date.now() - llmResponse.requestStartedMs),
      decision,
      status: "completed",
      llmModel: plannerLlmModel,
      ...TokenUsageMapper.toEntryFields(llmResponse.plannerTokenUsage),
    });
    const assistantText = String(agentic.assistant_output ?? "").trim();
    if (assistantText) {
      let assistantEntryId = llmResponse.assistantEntryId;
      if (!assistantEntryId) {
        assistantEntryId = crypto.randomUUID();
        this.chatEntries.appendAssistantMessage(conversationId, "", {
          id: assistantEntryId,
        });
        this.hub.publish(conversationId, {
          type: SseType.ASSISTANT_STREAM,
          chatEntryId: assistantEntryId,
          delta: assistantText,
        });
      }
      this.chatEntries.updateAssistantMessage(conversationId, {
        id: assistantEntryId,
        text: assistantText,
      });
    }
    this.publishConversationUpdated(conversationId);
    this.hub.publish(conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chatEntryId: llmResponse.plannerEntryId,
      summary:
        requestedToolCalls.length > 0
          ? `Queued ${requestedToolCalls.length} tool call(s)`
          : assistantText || "planner step completed",
      finished: true,
      action: requestedToolCalls.length > 0 ? "tool_call" : "final_answer",
      ...(requestedToolCalls.length > 0 ? { toolName: requestedToolCalls[0].toolName } : {}),
      llmModel: plannerLlmModel,
      ...TokenUsageMapper.toSseFields(llmResponse.plannerTokenUsage),
    });
    if (requestedToolCalls.length > 0) {
      const batchId = crypto.randomUUID();
      for (const requestedCall of requestedToolCalls) {
        const toolCfg = this.agentToolConfigFor(anchorUserMessage.agentId, requestedCall.toolName);
        this.enqueueRunTool({
          conversationId,
          agentId: anchorUserMessage.agentId,
          toolName: requestedCall.toolName,
          params: {},
          toolRequest: requestedCall.toolRequest,
          batchId,
          agentToolConfig: toolCfg,
        });
      }
      return;
    }

    if (agentic.followup !== "continue") {
      logger.info({ conversationId }, "[task] continue_conversation completed");
      return;
    }
    logger.warn(
      { conversationId, followup: agentic.followup },
      "[task] planner requested followup without tool call; waiting for next continuation trigger"
    );
  }
}
