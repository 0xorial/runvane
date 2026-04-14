import { ConversationEventHub } from "../events/conversationEventHub.js";
import { logger } from "../infra/logger.js";
import type { AgentsRepo } from "../infra/repositories/agentsRepo.js";
import { ChatEntriesRepo } from "../infra/repositories/chatEntriesRepo.js";
import { LlmProviderSettingsRepo } from "../infra/repositories/llmProviderSettingsRepo.js";
import { ModelPresetsRepo } from "../infra/repositories/modelPresetsRepo.js";
import { UploadsRepo } from "../infra/repositories/uploadsRepo.js";
import type { ContinueConversationTask } from "./agentTask.js";
import type { ToolPermission } from "../tools/baseTool.js";
import { ToolRegistry } from "../tools/toolRegistry.js";
import type {
  ChatEntry,
  LlmDecisionTool,
  LlmDecisionUserResponse,
  UserMessageEntry,
} from "../types/chatEntry.js";
import type { StreamTextCompletionResult } from "../llm_provider/provider.js";
import { SseType } from "../types/sse.js";

export class ContinueConversationTaskProcessor {
  constructor(
    private readonly chatEntries: ChatEntriesRepo,
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
    latestUserText: string;
    toolDescriptions: string[];
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
      (input.toolDescriptions.length > 0
        ? `<TOOLS>\n${input.toolDescriptions
            .map((line, idx) => `${idx + 1}. ${line}`)
            .join(
              "\n"
            )}\n\nIf a tool is required, return ONLY valid JSON with this exact shape:\n{"type":"tool-invocation","toolId":"<tool_name>","parameters":{}}\n\`parameters\` MUST match the tool params schema shown above.\nDo not wrap JSON in markdown fences.\n\nNever call the same tool repeatedly with identical parameters if a successful result already exists in recent conversation context.\nAfter receiving a successful tool result, produce <answer> unless another different tool call is strictly required.\n\nIf tool is NOT required, return text using XML tags:\n<thought>your reasoning shown in thinking pane</thought>\n<answer>only final user-visible answer</answer>\n</TOOLS>\n\n`
        : "") +
      `<CONVERSATION_SUMMARY>\n${summary}\n</CONVERSATION_SUMMARY>\n\n` +
      `<LATEST_USER_MESSAGE>\n${input.latestUserText}\n</LATEST_USER_MESSAGE>\n\n` +
      "Provide best possible answer to user's question. Use tools if necessary."
    );
  }

  private agentToolConfigFor(
    agentId: string | undefined,
    toolName: string
  ): {
    enabled: boolean;
    policy: ToolPermission;
    rules?: Record<string, unknown>;
  } {
    const agent = agentId ? this.agents.get(agentId) : null;
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

  private resolveLlmOverrides(lastUserMessage: UserMessageEntry): {
    llmProviderId?: string;
    llmModel?: string;
  } {
    const agentId = lastUserMessage.agentId;
    const agent = agentId ? this.agents.get(agentId) : null;
    const cfg = agent?.default_llm_configuration;
    const cfgProviderId = cfg?.provider_id;
    const cfgModelName = cfg?.model_name ?? cfg?.model;

    const llmProviderId =
      lastUserMessage.llmProviderId ??
      cfgProviderId ??
      agent?.model_reference?.provider_id;

    const llmModel =
      lastUserMessage.llmModel ??
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(withoutFence);
    } catch {
      const tagged = extractTaggedContent(reply);
      const answer = tagged.answer.trim();
      return {
        type: "user-response",
        text: answer || reply,
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { type: "user-response", text: reply };
    }
    const rec = parsed as Record<string, unknown>;
    if (rec.type !== "tool-invocation") {
      const tagged = extractTaggedContent(reply);
      const answer = tagged.answer.trim();
      return { type: "user-response", text: answer || reply };
    }
    const toolId = typeof rec.toolId === "string" ? rec.toolId.trim() : "";
    const parameters =
      rec.parameters &&
      typeof rec.parameters === "object" &&
      !Array.isArray(rec.parameters)
        ? (rec.parameters as Record<string, unknown>)
        : {};
    if (!toolId || !this.tools.get(toolId)) {
      const tagged = extractTaggedContent(reply);
      const answer = tagged.answer.trim();
      return { type: "user-response", text: answer || reply };
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
    logger.info({ conversationId }, "[task] continue_conversation started");
    const lastUserMessage = this.chatEntries.getLastUserMessage(conversationId);
    if (!lastUserMessage) {
      logger.warn(
        { conversationId },
        "[task] skipped continue_conversation: no user message"
      );
      return;
    }

    const plannerEntryId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const entries = this.chatEntries.listMessages(conversationId);
    const agent =
      lastUserMessage.agentId != null
        ? this.agents.get(lastUserMessage.agentId)
        : null;
    const toolDescriptions = this.tools
      .list()
      .filter(
        (tool) =>
          this.agentToolConfigFor(lastUserMessage.agentId, tool.getName())
            .enabled
      )
      .map((tool) => {
        const paramsSchema = JSON.stringify(tool.getParamsSchema());
        return `${tool.getName()}: ${tool.getAiDescription()} paramsSchema=${paramsSchema}`;
      });
    const requestText = this.buildPrompt({
      systemPrompt: agent?.system_prompt ?? "",
      entries,
      latestUserText: lastUserMessage.text,
      toolDescriptions,
    });
    const llmOverrides = this.resolveLlmOverrides(lastUserMessage);
    const selectedAgent = lastUserMessage.agentId ? this.agents.get(lastUserMessage.agentId) : null;
    const effectiveModelPresetId =
      lastUserMessage.modelPresetId ?? selectedAgent?.default_model_preset_id ?? null;
    const requestParams = this.resolveRequestParams({ modelPresetId: effectiveModelPresetId });
    const plannerLlmModel = this.resolvePlannerModel(llmOverrides);
    logger.info(
      {
        conversationId,
        plannerEntryId,
        requestChars: requestText.length,
        agentId: lastUserMessage.agentId ?? null,
        llmProviderId: llmOverrides.llmProviderId ?? null,
        llmModel: llmOverrides.llmModel ?? null,
        modelPresetId: lastUserMessage.modelPresetId ?? null,
      effectiveModelPresetId,
      requestParamKeys: Object.keys(requestParams),
      },
      "[task] planner request prepared"
    );

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
    const inputFiles = (lastUserMessage.attachments ?? []).map((attachment) => {
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
                firstStreamLatencyMs: Math.max(0, Date.now() - startedAtMs),
              },
              "[sse] first llm token streamed"
            );
          }
          reconstructedReply += delta;
          const tagged = extractTaggedContent(reconstructedReply);
          const nextThought = trimPartialKnownTagSuffix(reconstructedReply);
          const thoughtDelta = incrementalDelta(plannerText, nextThought);
          if (thoughtDelta) {
            this.hub.publish(conversationId, {
              type: SseType.PLANNER_LLM_STREAM,
              chat_entry_id: plannerEntryId,
              delta: thoughtDelta,
            });
          }
          plannerText = nextThought;

          const answerDelta = incrementalDelta(streamedAnswer, tagged.answer);
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
          streamedAnswer = tagged.answer;
        }
      );
      plannerTokenUsage = completion.usage;
      reply = reconstructedReply || completion.text || "";
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      logger.error(
        { conversationId, plannerEntryId, detail, error: e },
        "[task] llm failed"
      );
      this.chatEntries.updatePlannerLlmStreamEntry(conversationId, {
        id: plannerEntryId,
        llmRequest: requestText,
        llmResponse: detail,
        thoughtMs: Math.max(0, Date.now() - startedAtMs),
        decision: null,
        failed: true,
        llmModel: plannerLlmModel,
      });
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

    const decision = this.parseDecision(reply);
    logger.info(
      {
        conversationId,
        plannerEntryId,
        replyChars: reply.length,
      },
      "[task] persisting planner + assistant entries"
    );
    this.chatEntries.updatePlannerLlmStreamEntry(conversationId, {
      id: plannerEntryId,
      llmRequest: requestText,
      llmResponse: reply,
      thoughtMs: Math.max(0, Date.now() - startedAtMs),
      decision,
      failed: false,
      llmModel: plannerLlmModel,
      ...(plannerTokenUsage !== undefined
        ? {
            promptTokens: plannerTokenUsage.promptTokens,
            completionTokens: plannerTokenUsage.completionTokens,
          }
        : {}),
    });
    if (decision.type === "tool-invocation") {
      const toolCfg = this.agentToolConfigFor(
        lastUserMessage.agentId,
        decision.toolId
      );
      this.enqueueRunTool({
        conversationId,
        agentId: lastUserMessage.agentId ?? null,
        toolName: decision.toolId,
        params: decision.parameters,
        agentToolConfig: toolCfg,
      });
    } else {
      const finalAnswer = decision.text;
      if (!assistantEntryId) {
        assistantEntryId = crypto.randomUUID();
        this.chatEntries.appendAssistantMessage(conversationId, "", {
          id: assistantEntryId,
        });
        this.hub.publish(conversationId, {
          type: SseType.ASSISTANT_STREAM,
          chat_entry_id: assistantEntryId,
          delta: finalAnswer,
        });
      }
      this.chatEntries.updateAssistantMessage(conversationId, {
        id: assistantEntryId,
        text: finalAnswer,
      });
    }

    this.hub.publish(conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chat_entry_id: plannerEntryId,
      summary:
        decision.type === "tool-invocation"
          ? `Invoking tool: ${decision.toolId}`
          : decision.text,
      finished: true,
      action:
        decision.type === "tool-invocation" ? "tool_call" : "final_answer",
      ...(decision.type === "tool-invocation"
        ? { tool_name: decision.toolId }
        : {}),
      llm_model: plannerLlmModel,
      ...(plannerTokenUsage !== undefined
        ? {
            prompt_tokens: plannerTokenUsage.promptTokens,
            completion_tokens: plannerTokenUsage.completionTokens,
          }
        : {}),
    });
    logger.info(
      {
        conversationId,
        plannerEntryId,
        thoughtMs: Math.max(0, Date.now() - startedAtMs),
      },
      "[task] continue_conversation completed"
    );
  }
}

function extractTaggedContent(raw: string): {
  hasAnyTag: boolean;
  thought: string;
  answer: string;
} {
  const text = String(raw ?? "");
  const lower = text.toLowerCase();
  const thoughtOpenTag = "<thought>";
  const thoughtCloseTag = "</thought>";
  const answerOpenTag = "<answer>";
  const answerCloseTag = "</answer>";
  const thoughtOpen = lower.indexOf(thoughtOpenTag);
  const answerOpen = lower.indexOf(answerOpenTag);
  const hasAnyTag = thoughtOpen >= 0 || answerOpen >= 0;
  if (!hasAnyTag) return { hasAnyTag: false, thought: text, answer: "" };

  let thought = "";
  if (thoughtOpen >= 0) {
    const start = thoughtOpen + thoughtOpenTag.length;
    const close = lower.indexOf(thoughtCloseTag, start);
    thought = close >= 0 ? text.slice(start, close) : text.slice(start);
    const answerStart = lower.indexOf(answerOpenTag, start);
    if (close < 0 && answerStart >= 0) {
      thought = text.slice(start, answerStart);
    }
    thought = trimPartialKnownTagSuffix(sanitizeKnownTags(thought));
  }

  let answer = "";
  if (answerOpen >= 0) {
    const start = answerOpen + answerOpenTag.length;
    const close = lower.indexOf(answerCloseTag, start);
    if (close >= 0) {
      const core = text.slice(start, close);
      const tail = text.slice(close + answerCloseTag.length);
      answer = trimPartialKnownTagSuffix(sanitizeKnownTags(`${core}${tail}`));
    } else {
      answer = trimPartialKnownTagSuffix(sanitizeKnownTags(text.slice(start)));
    }
  }
  return { hasAnyTag: true, thought, answer };
}

function sanitizeKnownTags(text: string): string {
  return text
    .replace(/<\/?\s*(answer|thought)\s*>/gi, "")
    .replace(/<\/?\s*(answer|thought)\b[^>]*>/gi, "");
}

function trimPartialKnownTagSuffix(text: string): string {
  if (!text) return text;
  const tags = ["<thought>", "</thought>", "<answer>", "</answer>"];
  let out = text;
  while (out.length > 0) {
    const lower = out.toLowerCase();
    let matched = false;
    for (const tag of tags) {
      const tagLower = tag.toLowerCase();
      for (
        let len = Math.min(tagLower.length - 1, lower.length);
        len >= 1;
        len -= 1
      ) {
        if (tagLower.startsWith(lower.slice(-len))) {
          out = out.slice(0, -len);
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) break;
  }
  return out;
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
