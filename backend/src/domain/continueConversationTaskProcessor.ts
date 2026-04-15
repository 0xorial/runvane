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
import type {
  AgenticPlannerOutput,
  AgenticToolCall,
  ChatEntry,
  LlmDecision,
  LlmDecisionTool,
  LlmDecisionUserResponse,
  UserMessageEntry,
} from "../types/chatEntry.js";
import { AgenticPlannerOutputSchema } from "../types/chatEntry.js";
import type { StreamTextCompletionResult } from "../llm_provider/provider.js";
import { SseType } from "../types/sse.js";
import {
  clampToolCallsForTurn,
  DEFAULT_MAX_PLANNER_TURNS,
  DEFAULT_MAX_TOOL_CALLS_PER_TURN,
  shouldContinuePlannerLoop,
} from "./agenticLoopGuards.js";
import { usageByConversationId } from "./conversationUsage.js";

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
      batchId?: string;
      resumeAfterTool?: boolean;
      agentToolConfig?: {
        enabled?: boolean;
        policy?: ToolPermission;
        rules?: Record<string, unknown>;
      };
    }) => { taskId: number }
  ) {}

  private stringify(value: unknown): string {
    if (typeof value === "string") return value;
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : String(serialized);
  }

  private summarizeEntry(entry: ChatEntry): string {
    if (entry.type === "user-message") {
      const attachments = entry.attachments ?? [];
      if (attachments.length === 0) return `USER: ${entry.text}`;
      const attachmentSummary = attachments
        .map((a) => `${a.name} (${a.mimeType}, ${a.sizeBytes}b)`)
        .join(", ");
      return `USER: ${entry.text}\nATTACHMENTS: ${attachmentSummary}`;
    }
    if (entry.type === "assistant-message") {
      return `ASSISTANT: ${entry.text}`;
    }
    if (entry.type === "planner_llm_stream") {
      const response = entry.llmResponse ?? "";
      return `THINKING: ${response}`;
    }
    if (entry.type === "title_llm_stream") {
      const response = entry.llmResponse ?? "";
      return `TITLE_THINKING: ${response}`;
    }
    const parameters = this.stringify(entry.parameters);
    const result = this.stringify(entry.result);
    return `TOOL: id=${entry.toolId} state=${entry.state} parameters=${parameters} result=${result}`;
  }

  private buildPrompt(input: {
    systemPrompt: string;
    entries: ChatEntry[];
    anchorUserText: string;
    triggerEntry: ChatEntry | null;
    toolIds: string[];
    priorToolResults: Array<{
      toolId: string;
      ok: boolean;
      output: unknown;
      error: string | null;
    }>;
    loopState: Record<string, unknown>;
  }): string {
    const summaryLines = input.entries.map((entry, idx) => {
      return `${idx + 1}. ${this.summarizeEntry(entry)}`;
    });
    const summary = summaryLines.join("\n");
    const systemBlock = input.systemPrompt
      ? `<SYSTEM_PROMPT>\n${input.systemPrompt}\n</SYSTEM_PROMPT>\n\n`
      : "";
    return (
      `${systemBlock}` +
      (input.toolIds.length > 0
        ? `<TOOLS>\n${input.toolIds
            .map((line, idx) => `${idx + 1}. ${line}`)
            .join(
              "\n"
            )}\n\nReturn ONLY valid JSON with this exact shape:\n{\"assistant_output\":\"string optional\",\"tool_calls\":[{\"toolId\":\"<tool_name>\",\"parameters\":{}}],\"followup\":\"finalize|continue_with_results|retry_with_adjustment\",\"state\":{}}\n\nRules:\n- Use tool IDs from <TOOLS> only.\n- If no tools are needed, return empty tool_calls and followup=\"finalize\".\n- If tools are needed, include all calls for this step in tool_calls.\n- If prior tool errors exist and you need another attempt, use followup=\"retry_with_adjustment\".\n- Keep assistant_output as user-facing text for this step.\n</TOOLS>\n\n`
        : "") +
      (input.priorToolResults.length > 0
        ? `<PRIOR_TOOL_RESULTS>\n${input.priorToolResults
            .map(
              (row, idx) =>
                `${idx + 1}. tool=${row.toolId} ok=${
                  row.ok
                } output=${this.stringify(row.output)} error=${row.error ?? ""}`
            )
            .join("\n")}\n</PRIOR_TOOL_RESULTS>\n\n`
        : "") +
      (Object.keys(input.loopState).length > 0
        ? `<LOOP_STATE>\n${this.stringify(input.loopState)}\n</LOOP_STATE>\n\n`
        : "") +
      (input.triggerEntry
        ? `<TRIGGER_ENTRY>\n${this.summarizeEntry(
            input.triggerEntry
          )}\n</TRIGGER_ENTRY>\n\n`
        : "") +
      `<CONVERSATION_SUMMARY>\n${summary}\n</CONVERSATION_SUMMARY>\n\n` +
      `<ANCHOR_USER_MESSAGE>\n${input.anchorUserText}\n</ANCHOR_USER_MESSAGE>\n\n` +
      "Provide best possible answer to user's question. Use tools if necessary."
    );
  }
  private parseAgenticPlannerOutput(
    reply: string,
    streamedAnswer: string
  ): {
    output: AgenticPlannerOutput;
    decision: LlmDecision;
  } {
    const cleaned = reply.trim();
    const withoutFence = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = parseFirstJsonObjectCandidate([
      withoutFence,
      extractLastBalancedJsonObject(withoutFence),
    ]);
    const assistantFallback =
      streamedAnswer || extractAssistantOutputFromJsonLike(reply) || "";
    const parsedAgentic = AgenticPlannerOutputSchema.safeParse(parsed);
    if (parsedAgentic.success) {
      const normalizedToolCalls = parsedAgentic.data.tool_calls.filter((call) =>
        this.tools.get(call.toolId)
      );
      const output: AgenticPlannerOutput = {
        ...parsedAgentic.data,
        tool_calls: normalizedToolCalls,
        ...(parsedAgentic.data.assistant_output == null
          ? { assistant_output: assistantFallback }
          : {}),
      };
      const decision: LlmDecision =
        normalizedToolCalls.length > 0
          ? ({
              type: "tool-invocation",
              toolId: normalizedToolCalls[0].toolId,
              parameters: normalizedToolCalls[0].parameters,
            } satisfies LlmDecisionTool)
          : ({
              type: "user-response",
              text: String(output.assistant_output ?? "").trim() || reply,
            } satisfies LlmDecisionUserResponse);
      return { output, decision };
    }
    const fallbackDecision = this.parseDecision(reply);
    const fallbackOutput: AgenticPlannerOutput = {
      assistant_output:
        fallbackDecision.type === "user-response"
          ? fallbackDecision.text
          : assistantFallback,
      tool_calls:
        fallbackDecision.type === "tool-invocation"
          ? [
              {
                toolId: fallbackDecision.toolId,
                parameters: fallbackDecision.parameters,
              },
            ]
          : [],
      followup:
        fallbackDecision.type === "tool-invocation"
          ? "continue_with_results"
          : "finalize",
    };
    return { output: fallbackOutput, decision: fallbackDecision };
  }

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
          usageByConversationId(
            this.chatEntries.listConversationTokenUsageByModel()
          ).get(conversationId) ?? [],
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
    const enabled =
      toolCfg?.enabled === undefined ? true : toolCfg.enabled === true;
    const policy: ToolPermission = toolCfg?.policy ?? "allow";
    const tool = this.tools.get(toolName);
    const defaultRules =
      tool &&
      typeof tool.getDefaultRules() === "object" &&
      tool.getDefaultRules() != null
        ? (tool.getDefaultRules() as unknown as Record<string, unknown>)
        : {};
    const rules = toolCfg?.rules ?? defaultRules;
    return { enabled, policy, ...(rules ? { rules } : {}) };
  }

  private resolveLlmOverrides(anchorUserMessage: UserMessageEntry): {
    llmProviderId?: string;
    llmModel?: string;
  } {
    const agentId = anchorUserMessage.agentId;
    const agent = this.agents.get(agentId);
    const cfg = agent?.default_llm_configuration;
    const cfgProviderId = cfg?.provider_id;
    const cfgModelName = cfg?.model_name ?? cfg?.model;

    const llmProviderId =
      anchorUserMessage.llmProviderId ??
      cfgProviderId ??
      agent?.model_reference?.provider_id;

    const llmModel =
      anchorUserMessage.llmModel ??
      cfgModelName ??
      agent?.model_reference?.model_name;

    return {
      ...(llmProviderId ? { llmProviderId } : {}),
      ...(llmModel ? { llmModel } : {}),
    };
  }

  private parseDecision(
    reply: string
  ): LlmDecisionUserResponse | LlmDecisionTool {
    const cleaned = reply.trim();
    const withoutFence = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const assistantFallback = extractAssistantOutputFromJsonLike(reply).trim();
    const parsed = parseFirstJsonObjectCandidate([
      withoutFence,
      extractLastBalancedJsonObject(withoutFence),
    ]);
    if (parsed === null) {
      return {
        type: "user-response",
        text: assistantFallback || reply,
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { type: "user-response", text: assistantFallback || reply };
    }
    const rec = parsed as Record<string, unknown>;
    if (rec.type === "user-response") {
      const text = typeof rec.text === "string" ? rec.text.trim() : "";
      return {
        type: "user-response",
        text: text || assistantFallback || reply,
      };
    }
    if (rec.type !== "tool-invocation") {
      return { type: "user-response", text: assistantFallback || reply };
    }
    const toolId = typeof rec.toolId === "string" ? rec.toolId.trim() : "";
    const parameters =
      rec.parameters &&
      typeof rec.parameters === "object" &&
      !Array.isArray(rec.parameters)
        ? (rec.parameters as Record<string, unknown>)
        : {};
    if (!toolId || !this.tools.get(toolId)) {
      return { type: "user-response", text: assistantFallback || reply };
    }
    return {
      type: "tool-invocation",
      toolId,
      parameters,
    };
  }

  private resolvePlannerModel(overrides: { llmModel?: string }): string {
    const doc = this.llmProviderSettings.getDocument();
    return String(
      overrides.llmModel || doc.llm_configuration.model_name || "gpt-4o-mini"
    );
  }

  private parseStructuredParamValue(key: string, value: unknown): unknown {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return value;

    // Model presets editor stores values as strings; for structured output keys we require valid JSON.
    if (
      key === "response_format" ||
      key === "json_schema" ||
      key === "schema" ||
      key === "structured_output"
    ) {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`invalid JSON for model parameter "${key}": ${msg}`);
      }
    }
    return value;
  }

  private resolveRequestParams(input: {
    modelPresetId?: number | null;
  }): Record<string, unknown> {
    const doc = this.llmProviderSettings.getDocument();
    const out: Record<string, unknown> = {};
    const globalSettings = doc.llm_configuration.model_settings;
    if (
      globalSettings &&
      typeof globalSettings === "object" &&
      !Array.isArray(globalSettings)
    ) {
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
    const providerId = String(
      overrides.llmProviderId || doc.llm_configuration.provider_id || "openai"
    );
    const model = this.resolvePlannerModel(overrides);
    const provider = this.llmProviderSettings.getProvider(providerId);
    if (!provider) throw new Error(`unknown provider: ${providerId}`);
    const providerSettings =
      this.llmProviderSettings.getProviderSettings(providerId);
    if (!providerSettings)
      throw new Error(`provider settings not found: ${providerId}`);

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

  async process(task: ContinueConversationTask): Promise<void> {
    const conversationId = task.conversationId;
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
    const effectiveModelPresetId =
      anchorUserMessage.modelPresetId ??
      selectedAgent?.default_model_preset_id ??
      null;
    const requestParams = this.resolveRequestParams({
      modelPresetId: effectiveModelPresetId,
    });
    const plannerLlmModel = this.resolvePlannerModel(llmOverrides);
    const inputFiles = (anchorUserMessage.attachments ?? []).map((attachment) => {
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
    const enabledToolIds = this.tools
      .list()
      .filter(
        (tool) =>
          this.agentToolConfigFor(anchorUserMessage.agentId, tool.getName())
            .enabled
      )
      .map((tool) => tool.getName());
    const MAX_PLANNER_TURNS = DEFAULT_MAX_PLANNER_TURNS;
    const MAX_TOOL_CALLS_PER_TURN = DEFAULT_MAX_TOOL_CALLS_PER_TURN;
    let loopState: Record<string, unknown> = {};

    for (
      let plannerTurn = 1;
      plannerTurn <= MAX_PLANNER_TURNS;
      plannerTurn += 1
    ) {
      this.hub.publish(conversationId, {
        type: SseType.PLANNER_TURN_STARTED,
        planner_turn: plannerTurn,
        max_turns: MAX_PLANNER_TURNS,
      });
      const entries = this.chatEntries.listMessages(conversationId);
      const priorToolResults = entries
        .filter(
          (entry): entry is Extract<ChatEntry, { type: "tool-invocation" }> =>
            entry.type === "tool-invocation"
        )
        .slice(-8)
        .map((entry) => {
          const result =
            entry.result &&
            typeof entry.result === "object" &&
            !Array.isArray(entry.result)
              ? (entry.result as Record<string, unknown>)
              : {};
          return {
            toolId: String(result.toolId ?? entry.toolId),
            ok: result.ok === true,
            output: result.output ?? null,
            error: typeof result.error === "string" ? result.error : null,
          };
        });
      const requestText = this.buildPrompt({
        systemPrompt: agent?.system_prompt ?? "",
        entries,
        anchorUserText: anchorUserMessage.text,
        triggerEntry: entries.at(-1) ?? null,
        toolIds: enabledToolIds,
        priorToolResults,
        loopState,
      });
      const plannerEntryId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const turnStartedMs = Date.now();
      const plannerEntry = this.chatEntries.appendPlannerLlmStreamEntry(
        conversationId,
        {
          id: plannerEntryId,
          createdAt,
          llmRequest: requestText,
          llmResponse: "",
          thoughtMs: null,
          decision: null,
          failed: false,
          llmModel: plannerLlmModel,
        }
      );
      this.hub.publish(conversationId, {
        type: SseType.PLANNER_STARTING,
        chat_entry_id: plannerEntryId,
        conversationIndex: plannerEntry.conversationIndex,
        createdAt: plannerEntry.createdAt,
        request_text: requestText,
        llm_model: plannerLlmModel,
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
          requestText,
          llmOverrides,
          requestParams,
          inputFiles,
          (delta) => {
            if (!firstDeltaPublished) {
              firstDeltaPublished = true;
              logger.info(
                {
                  conversationId,
                  plannerEntryId,
                  plannerTurn,
                  firstStreamLatencyMs: Math.max(0, Date.now() - turnStartedMs),
                },
                "[sse] first llm token streamed"
              );
            }
            reconstructedReply += delta;
            const nextThought = reconstructedReply;
            const thoughtDelta = incrementalDelta(plannerText, nextThought);
            if (thoughtDelta) {
              this.hub.publish(conversationId, {
                type: SseType.PLANNER_LLM_STREAM,
                chat_entry_id: plannerEntryId,
                delta: thoughtDelta,
              });
            }
            plannerText = nextThought;

            const streamedAssistantOutput =
              extractAssistantOutputFromJsonLike(reconstructedReply);
            const answerDelta = incrementalDelta(
              streamedAnswer,
              streamedAssistantOutput
            );
            if (answerDelta) {
              if (!assistantEntryId) {
                assistantEntryId = crypto.randomUUID();
                this.chatEntries.appendAssistantMessage(conversationId, "", {
                  id: assistantEntryId,
                });
              }
              this.hub.publish(conversationId, {
                type: SseType.ASSISTANT_STREAM,
                chat_entry_id: assistantEntryId,
                delta: answerDelta,
              });
            }
            streamedAnswer = streamedAssistantOutput;
          }
        );
        plannerTokenUsage = completion.usage;
        reply = reconstructedReply || completion.text || "";
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        this.chatEntries.updatePlannerLlmStreamEntry(conversationId, {
          id: plannerEntryId,
          llmRequest: requestText,
          llmResponse: detail,
          thoughtMs: Math.max(0, Date.now() - turnStartedMs),
          decision: null,
          failed: true,
          llmModel: plannerLlmModel,
        });
        this.publishConversationUpdated(conversationId);
        this.hub.publish(conversationId, {
          type: SseType.PLANNER_RESPONSE,
          chat_entry_id: plannerEntryId,
          summary: detail,
          finished: true,
          action: "failed",
          llm_model: plannerLlmModel,
        });
        throw e;
      }

      const parsedAgentic = this.parseAgenticPlannerOutput(
        reply,
        streamedAnswer
      );
      const decision = parsedAgentic.decision;
      const agentic = parsedAgentic.output;
      loopState =
        agentic.state &&
        typeof agentic.state === "object" &&
        !Array.isArray(agentic.state)
          ? agentic.state
          : loopState;
      this.chatEntries.updatePlannerLlmStreamEntry(conversationId, {
        id: plannerEntryId,
        llmRequest: requestText,
        llmResponse: reply,
        thoughtMs: Math.max(0, Date.now() - turnStartedMs),
        decision,
        failed: false,
        llmModel: plannerLlmModel,
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
      const assistantText = String(agentic.assistant_output ?? "").trim();
      if (assistantText) {
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
        chat_entry_id: plannerEntryId,
        summary:
          agentic.tool_calls.length > 0
            ? `Queued ${agentic.tool_calls.length} tool call(s)`
            : assistantText || "planner step completed",
        finished: true,
        action: agentic.tool_calls.length > 0 ? "tool_call" : "final_answer",
        ...(agentic.tool_calls.length > 0
          ? { tool_name: agentic.tool_calls[0].toolId }
          : {}),
        llm_model: plannerLlmModel,
        ...(plannerTokenUsage !== undefined
          ? {
              prompt_tokens: plannerTokenUsage.promptTokens,
              ...(plannerTokenUsage.cachedPromptTokens !== undefined
                ? { cached_prompt_tokens: plannerTokenUsage.cachedPromptTokens }
                : {}),
              completion_tokens: plannerTokenUsage.completionTokens,
            }
          : {}),
      });
      this.hub.publish(conversationId, {
        type: SseType.PLANNER_TURN_COMPLETED,
        planner_turn: plannerTurn,
        followup: agentic.followup,
        tool_calls: agentic.tool_calls.length,
      });

      if (agentic.tool_calls.length > 0) {
        const selectedCalls: AgenticToolCall[] = clampToolCallsForTurn(
          agentic.tool_calls,
          MAX_TOOL_CALLS_PER_TURN
        );
        const batchId = crypto.randomUUID();
        this.hub.publish(conversationId, {
          type: SseType.TOOL_BATCH_STARTED,
          batch_id: batchId,
          total_calls: selectedCalls.length,
        });
        for (let i = 0; i < selectedCalls.length; i += 1) {
          const call = selectedCalls[i];
          const toolCfg = this.agentToolConfigFor(
            anchorUserMessage.agentId,
            call.toolId
          );
          const shouldResumeAfterBatch =
            shouldContinuePlannerLoop(agentic.followup) &&
            i === selectedCalls.length - 1;
          this.enqueueRunTool({
            conversationId,
            agentId: anchorUserMessage.agentId,
            toolName: call.toolId,
            params: call.parameters,
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

      if (!shouldContinuePlannerLoop(agentic.followup)) {
        logger.info(
          { conversationId, plannerTurn },
          "[task] continue_conversation completed"
        );
        return;
      }
    }

    this.hub.publish(conversationId, {
      type: SseType.PLANNER_GUARD_STOP,
      reason: "max_planner_turns_reached",
      planner_turn: MAX_PLANNER_TURNS,
      max_turns: MAX_PLANNER_TURNS,
    });
    logger.warn(
      { conversationId, maxTurns: MAX_PLANNER_TURNS },
      "[task] planner guard stop reached"
    );
  }
}

function incrementalDelta(prev: string, next: string): string {
  if (!next) return "";
  if (!prev) return next;
  if (next.startsWith(prev)) return next.slice(prev.length);
  const prefix = commonPrefixLen(prev, next);
  return next.slice(prefix);
}

function commonPrefixLen(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i += 1;
  return i;
}

function extractAssistantOutputFromJsonLike(text: string): string {
  const source = String(text ?? "");
  if (!source) return "";
  const keyMatch = /"assistant_output"\s*:\s*"/.exec(source);
  if (!keyMatch) return "";
  let i = keyMatch.index + keyMatch[0].length;
  let out = "";
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') return out;
    if (ch !== "\\") {
      out += ch;
      i += 1;
      continue;
    }
    const esc = source[i + 1];
    if (esc == null) return out;
    if (esc === '"' || esc === "\\" || esc === "/") {
      out += esc;
      i += 2;
      continue;
    }
    if (esc === "b") {
      out += "\b";
      i += 2;
      continue;
    }
    if (esc === "f") {
      out += "\f";
      i += 2;
      continue;
    }
    if (esc === "n") {
      out += "\n";
      i += 2;
      continue;
    }
    if (esc === "r") {
      out += "\r";
      i += 2;
      continue;
    }
    if (esc === "t") {
      out += "\t";
      i += 2;
      continue;
    }
    if (esc === "u") {
      const hex = source.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 6;
      continue;
    }
    out += esc;
    i += 2;
  }
  return out;
}

function parseFirstJsonObjectCandidate(
  candidates: Array<string | null>
): unknown | null {
  for (const candidate of candidates) {
    const raw = String(candidate ?? "").trim();
    if (!raw) continue;
    try {
      return JSON.parse(raw);
    } catch {
      // Try next candidate form.
    }
  }
  return null;
}

function extractLastBalancedJsonObject(text: string): string | null {
  const source = String(text ?? "");
  if (!source) return null;
  let end = source.length - 1;
  while (end >= 0 && /\s/.test(source[end])) end -= 1;
  if (end < 0 || source[end] !== "}") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = end; i >= 0; i -= 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "}") {
      depth += 1;
      continue;
    }
    if (ch === "{") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(i, end + 1).trim();
      }
      continue;
    }
  }
  return null;
}
