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
import type { AgenticToolCall, AgenticToolRequest, ChatEntry, UserMessageEntry } from "../types/chatEntry.js";
import { type StreamTextCompletionResult } from "../llm_provider/provider.js";
import { SseType } from "../types/sse.js";
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
      toolInvocationEntryId?: string;
      batchId?: string;
      resumeAfterTool?: boolean;
      agentToolConfig?: {
        enabled?: boolean;
        policy?: ToolPermission;
        rules?: Record<string, unknown>;
      };
    }) => { taskId: number },
  ) {}

  private publishConversationUpdated(conversationId: string): void {
    const conversation = this.conversations.get(conversationId, {
      includeDeleted: true,
    });
    if (!conversation) return;
    this.hub.publish(conversationId, {
      type: SseType.CONVERSATION_UPDATED,
      conversation: {
        ...conversation,
        is_deleted: Number(conversation.is_deleted ?? 0) === 1,
        token_usage_by_model:
          usageByConversationId(this.chatEntries.listConversationTokenUsageByModel()).get(conversationId) ?? [],
      },
    });
  }

  private agentToolConfigFor(
    agentId: string,
    toolName: string,
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

  private resolveToolResolverOverrides(overrides: {
    llmProviderId?: string;
    llmModel?: string;
  }): { llmProviderId?: string; llmModel?: string } {
    const cfg = this.llmProviderSettings.getDocument().llm_configuration;
    const resolverProviderId = String(cfg.tool_call_provider_id ?? "").trim();
    const resolverModel = String(cfg.tool_call_model_name ?? "").trim();
    return {
      ...(resolverProviderId ? { llmProviderId: resolverProviderId } : {}),
      ...(resolverModel
        ? { llmModel: resolverModel }
        : { ...(overrides.llmModel ? { llmModel: overrides.llmModel } : {}) }),
      ...(resolverProviderId ? {} : { ...(overrides.llmProviderId ? { llmProviderId: overrides.llmProviderId } : {}) }),
    };
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

  private sanitizeRequestParamsForToolResolver(requestParams: Record<string, unknown>): Record<string, unknown> {
    const out = { ...requestParams };
    delete out.response_format;
    delete out.json_schema;
    delete out.schema;
    delete out.structured_output;
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
    onDelta: (delta: string) => void,
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
      "[llm] request formatted",
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
            "[llm] first token received",
          );
        }
        onDelta(delta);
      },
    );
    logger.info(
      {
        providerId,
        model,
        responseChars: result.text.length,
        usage: result.usage ?? null,
      },
      "[llm] completion finished",
    );
    return result;
  }

  private async resolveToolRequestsWithLlm(input: {
    conversationId: string;
    requests: AgenticToolRequest[];
    enabledToolIds: string[];
    llmOverrides: { llmProviderId?: string; llmModel?: string };
    requestParams: Record<string, unknown>;
    files: Array<{ filename: string; mimeType: string; base64Data: string }>;
    shouldCancel?: () => boolean;
  }): Promise<Array<{ call: AgenticToolCall; toolInvocationEntryId: string }>> {
    if (input.requests.length === 0) return [];
    const out: Array<{ call: AgenticToolCall; toolInvocationEntryId: string }> = [];
    const allowedTools = new Set(input.enabledToolIds);
    const resolverOverrides = this.resolveToolResolverOverrides(input.llmOverrides);
    const resolverModel = this.resolvePlannerModel(resolverOverrides);
    const resolverRequestParams = this.sanitizeRequestParamsForToolResolver(input.requestParams);
    for (const request of input.requests) {
      throwIfCancelled(input.shouldCancel);
      const toolName = String(request.tool_name ?? "").trim();
      const toolRequest = String(request.request ?? "").trim();
      if (!toolName || !toolRequest) continue;
      if (!allowedTools.has(toolName)) {
        throw new Error(`tool request references disabled or unknown tool: ${toolName}`);
      }
      const tool = this.tools.get(toolName);
      if (!tool) {
        throw new Error(`tool request references unknown tool: ${toolName}`);
      }
      const toolInvocationEntry = this.chatEntries.appendToolInvocation(input.conversationId, {
        toolId: toolName,
        state: "requested",
        parameters: {
          tool_request: toolRequest,
          source: "planner_tool_request",
        },
        result: null,
      });
      this.hub.publish(input.conversationId, {
        type: SseType.TOOL_INVOCATION_START,
        chat_entry_id: toolInvocationEntry.id,
        tool_name: toolName,
        approval_required: true,
        args_preview: toolRequest,
      });
      const toolParamPrompt = `You produce ONLY JSON object parameters for one tool.

Tool name: ${tool.getName()}
Tool AI description: ${tool.getAiDescription()}
Tool parameter JSON schema:
${JSON.stringify(tool.getParamsSchema(), null, 2)}

Tool request:
${toolRequest}

Return ONLY valid JSON object for tool parameters.`;
      const resolverEntryId = crypto.randomUUID();
      const resolverCreatedAt = new Date().toISOString();
      const resolverStartedAtMs = Date.now();
      const resolverEntry = this.chatEntries.appendPlannerLlmStreamEntry(input.conversationId, {
        id: resolverEntryId,
        createdAt: resolverCreatedAt,
        llmRequest: toolParamPrompt,
        llmResponse: "",
        thoughtMs: null,
        decision: null,
        status: "running",
        llmModel: resolverModel,
      });
      this.hub.publish(input.conversationId, {
        type: SseType.PLANNER_STARTING,
        chat_entry_id: resolverEntryId,
        conversationIndex: resolverEntry.conversationIndex,
        createdAt: resolverEntry.createdAt,
        request_text: toolParamPrompt,
        llm_model: resolverModel,
      });

      let reconstructedReply = "";
      let resolverTokenUsage: StreamTextCompletionResult["usage"];
      let completionText = "";
      try {
        const completion = await this.callLlmStreaming(
          toolParamPrompt,
          resolverOverrides,
          resolverRequestParams,
          input.files,
          (delta) => {
            throwIfCancelled(input.shouldCancel);
            reconstructedReply += delta;
            this.hub.publish(input.conversationId, {
              type: SseType.PLANNER_LLM_STREAM,
              chat_entry_id: resolverEntryId,
              delta,
            });
          },
        );
        resolverTokenUsage = completion.usage;
        completionText = reconstructedReply || completion.text || "";
      } catch (e) {
        const partialUsage = usageFromStreamingError(e);
        if (partialUsage) {
          resolverTokenUsage = partialUsage;
        }
        const detail = e instanceof Error ? e.message : String(e);
        const cancelled = isTaskCancelledError(e);
        this.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
          id: resolverEntryId,
          llmRequest: toolParamPrompt,
          llmResponse: composeFailedPlannerResponse(reconstructedReply),
          thoughtMs: Math.max(0, Date.now() - resolverStartedAtMs),
          decision: null,
          status: cancelled ? "cancelled" : "failed",
          error: detail,
          llmModel: resolverModel,
          ...(resolverTokenUsage !== undefined
            ? {
                promptTokens: resolverTokenUsage.promptTokens,
                ...(resolverTokenUsage.cachedPromptTokens !== undefined
                  ? { cachedPromptTokens: resolverTokenUsage.cachedPromptTokens }
                  : {}),
                completionTokens: resolverTokenUsage.completionTokens,
              }
            : {}),
        });
        this.publishConversationUpdated(input.conversationId);
        this.hub.publish(input.conversationId, {
          type: SseType.PLANNER_RESPONSE,
          chat_entry_id: resolverEntryId,
          summary: cancelled ? "Cancelled" : detail,
          finished: true,
          action: cancelled ? "cancelled" : "failed",
          llm_model: resolverModel,
          ...(resolverTokenUsage !== undefined
            ? {
                prompt_tokens: resolverTokenUsage.promptTokens,
                ...(resolverTokenUsage.cachedPromptTokens !== undefined
                  ? { cached_prompt_tokens: resolverTokenUsage.cachedPromptTokens }
                  : {}),
                completion_tokens: resolverTokenUsage.completionTokens,
              }
            : {}),
        });
        this.chatEntries.updateToolInvocation(input.conversationId, {
          id: toolInvocationEntry.id,
          state: "error",
          result: {
            ok: false,
            toolId: toolName,
            output: null,
            error: detail,
            stage: "tool_request_resolution",
          },
        });
        this.hub.publish(input.conversationId, {
          type: SseType.TOOL_INVOCATION_END,
          tool_name: toolName,
          output: detail,
          ok: false,
        });
        throw e;
      }

      const raw = String(completionText)
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        throw new Error(`tool resolver returned invalid JSON for ${toolName}`, { cause: e });
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`tool resolver did not return object params for ${toolName}`);
      }
      const validatedParams = tool.parseParams(parsed) as unknown;
      if (!validatedParams || typeof validatedParams !== "object" || Array.isArray(validatedParams)) {
        throw new Error(`tool.parseParams produced invalid object for ${toolName}`);
      }
      this.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
        id: resolverEntryId,
        llmRequest: toolParamPrompt,
        llmResponse: completionText,
        thoughtMs: Math.max(0, Date.now() - resolverStartedAtMs),
        decision: {
          type: "tool-invocation",
          toolId: toolName,
          parameters: {},
        },
        status: "completed",
        llmModel: resolverModel,
        ...(resolverTokenUsage !== undefined
          ? {
              promptTokens: resolverTokenUsage.promptTokens,
              ...(resolverTokenUsage.cachedPromptTokens !== undefined
                ? { cachedPromptTokens: resolverTokenUsage.cachedPromptTokens }
                : {}),
              completionTokens: resolverTokenUsage.completionTokens,
            }
          : {}),
      });
      this.publishConversationUpdated(input.conversationId);
      this.hub.publish(input.conversationId, {
        type: SseType.PLANNER_RESPONSE,
        chat_entry_id: resolverEntryId,
        summary: `Resolved parameters for ${toolName}`,
        finished: true,
        action: "tool_call",
        tool_name: toolName,
        llm_model: resolverModel,
        ...(resolverTokenUsage !== undefined
          ? {
              prompt_tokens: resolverTokenUsage.promptTokens,
              ...(resolverTokenUsage.cachedPromptTokens !== undefined
                ? { cached_prompt_tokens: resolverTokenUsage.cachedPromptTokens }
                : {}),
              completion_tokens: resolverTokenUsage.completionTokens,
            }
          : {}),
      });
      out.push({
        toolInvocationEntryId: toolInvocationEntry.id,
        call: {
          toolId: toolName,
          parameters: validatedParams as Record<string, unknown>,
        },
      });
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

  private async getLlmResponseForTurn(input: {
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
      chat_entry_id: plannerEntryId,
      conversationIndex: plannerEntry.conversationIndex,
      createdAt: plannerEntry.createdAt,
      request_text: input.requestText,
      llm_model: input.plannerLlmModel,
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
              "[sse] first llm token streamed",
            );
          }
          reconstructedReply += delta;
          const nextThought = reconstructedReply;
          const thoughtDelta = incrementalDelta(plannerText, nextThought);
          if (thoughtDelta) {
            this.hub.publish(input.conversationId, {
              type: SseType.PLANNER_LLM_STREAM,
              chat_entry_id: plannerEntryId,
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
              chat_entry_id: assistantEntryId,
              delta: answerDelta,
            });
          }
          streamedAnswer = streamedAssistantOutput;
        },
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
          ...(plannerTokenUsage !== undefined
            ? {
                promptTokens: plannerTokenUsage.promptTokens,
                ...(plannerTokenUsage.cachedPromptTokens !== undefined
                  ? {
                      cachedPromptTokens: plannerTokenUsage.cachedPromptTokens,
                    }
                  : {}),
                completionTokens: plannerTokenUsage.completionTokens,
              }
            : {}),
        });
        this.publishConversationUpdated(input.conversationId);
        this.hub.publish(input.conversationId, {
          type: SseType.PLANNER_RESPONSE,
          chat_entry_id: plannerEntryId,
          summary: "Cancelled",
          finished: true,
          action: "cancelled",
          llm_model: input.plannerLlmModel,
          ...(plannerTokenUsage !== undefined
            ? {
                prompt_tokens: plannerTokenUsage.promptTokens,
                ...(plannerTokenUsage.cachedPromptTokens !== undefined
                  ? {
                      cached_prompt_tokens: plannerTokenUsage.cachedPromptTokens,
                    }
                  : {}),
                completion_tokens: plannerTokenUsage.completionTokens,
              }
            : {}),
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
        ...(plannerTokenUsage !== undefined
          ? {
              promptTokens: plannerTokenUsage.promptTokens,
              ...(plannerTokenUsage.cachedPromptTokens !== undefined
                ? { cachedPromptTokens: plannerTokenUsage.cachedPromptTokens }
                : {}),
              completionTokens: plannerTokenUsage.completionTokens,
            }
          : {}),
      });
      this.publishConversationUpdated(input.conversationId);
      this.hub.publish(input.conversationId, {
        type: SseType.PLANNER_RESPONSE,
        chat_entry_id: plannerEntryId,
        summary: detail,
        finished: true,
        action: "failed",
        llm_model: input.plannerLlmModel,
        ...(plannerTokenUsage !== undefined
          ? {
              prompt_tokens: plannerTokenUsage.promptTokens,
              ...(plannerTokenUsage.cachedPromptTokens !== undefined
                ? {
                    cached_prompt_tokens: plannerTokenUsage.cachedPromptTokens,
                  }
                : {}),
              completion_tokens: plannerTokenUsage.completionTokens,
            }
          : {}),
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
      "[task] continue_conversation started",
    );
    const anchorUserMessage = [...initialEntries]
      .reverse()
      .find((entry): entry is UserMessageEntry => entry.type === "user-message");
    if (!anchorUserMessage) {
      logger.warn(
        { conversationId, triggerEntryType: triggerEntry?.type ?? null },
        "[task] skipped continue_conversation: no user message",
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
    const maxToolRequestsPerPass = 4;
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
    const llmResponse = await this.getLlmResponseForTurn({
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
    const queuedToolRequests = await this.resolveToolRequestsWithLlm({
      conversationId,
      requests: agentic.tool_requests,
      enabledToolIds,
      llmOverrides,
      requestParams,
      files: inputFiles,
      shouldCancel: opts?.shouldCancel,
    });
    const allToolCalls = queuedToolRequests;
    this.chatEntries.updatePlannerLlmStreamEntry(conversationId, {
      id: llmResponse.plannerEntryId,
      llmRequest: llmRequest,
      llmResponse: llmResponse.reply,
      thoughtMs: Math.max(0, Date.now() - llmResponse.requestStartedMs),
      decision,
      status: "completed",
      llmModel: plannerLlmModel,
      ...(llmResponse.plannerTokenUsage !== undefined
        ? {
            promptTokens: llmResponse.plannerTokenUsage.promptTokens,
            ...(llmResponse.plannerTokenUsage.cachedPromptTokens !== undefined
              ? { cachedPromptTokens: llmResponse.plannerTokenUsage.cachedPromptTokens }
              : {}),
            completionTokens: llmResponse.plannerTokenUsage.completionTokens,
          }
        : {}),
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
          chat_entry_id: assistantEntryId,
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
      chat_entry_id: llmResponse.plannerEntryId,
      summary:
        allToolCalls.length > 0
          ? `Queued ${allToolCalls.length} tool call(s)`
          : assistantText || "planner step completed",
      finished: true,
      action: allToolCalls.length > 0 ? "tool_call" : "final_answer",
      ...(allToolCalls.length > 0 ? { tool_name: allToolCalls[0].call.toolId } : {}),
      llm_model: plannerLlmModel,
      ...(llmResponse.plannerTokenUsage !== undefined
        ? {
            prompt_tokens: llmResponse.plannerTokenUsage.promptTokens,
            ...(llmResponse.plannerTokenUsage.cachedPromptTokens !== undefined
              ? { cached_prompt_tokens: llmResponse.plannerTokenUsage.cachedPromptTokens }
              : {}),
            completion_tokens: llmResponse.plannerTokenUsage.completionTokens,
          }
        : {}),
    });
    if (allToolCalls.length > 0) {
      const selectedCount = Math.max(0, Math.trunc(maxToolRequestsPerPass));
      const selectedCalls = allToolCalls.slice(0, selectedCount);
      const batchId = crypto.randomUUID();
      this.hub.publish(conversationId, {
        type: SseType.TOOL_BATCH_STARTED,
        batch_id: batchId,
        total_calls: selectedCalls.length,
      });
      for (let i = 0; i < selectedCalls.length; i += 1) {
        const call = selectedCalls[i].call;
        const toolCfg = this.agentToolConfigFor(anchorUserMessage.agentId, call.toolId);
        const shouldResumeAfterBatch = agentic.followup === "continue" && i === selectedCalls.length - 1;
        this.enqueueRunTool({
          conversationId,
          agentId: anchorUserMessage.agentId,
          toolName: call.toolId,
          params: call.parameters,
          toolInvocationEntryId: selectedCalls[i].toolInvocationEntryId,
          batchId,
          resumeAfterTool: shouldResumeAfterBatch,
          agentToolConfig: toolCfg,
        });
      }
      this.hub.publish(conversationId, {
        type: SseType.TOOL_BATCH_COMPLETED,
        batch_id: batchId,
        total_calls: selectedCalls.length,
      });
      return;
    }

    if (agentic.followup !== "continue") {
      logger.info({ conversationId }, "[task] continue_conversation completed");
      return;
    }
    logger.warn(
      { conversationId, followup: agentic.followup },
      "[task] planner requested followup without tool call; waiting for next continuation trigger",
    );
  }
}
