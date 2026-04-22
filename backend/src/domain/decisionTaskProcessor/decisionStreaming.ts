import { logger } from "../../infra/logger.js";
import type { StreamTextCompletionResult } from "../../llm_provider/provider.js";
import { SseType } from "../../types/sse.js";
import { TokenUsageMapper } from "../../types/tokenUsage.js";
import type { ThoughtActionEntry } from "../../types/chatEntry.js";
import { isTaskCancelledError, throwIfCancelled } from "../taskCancellation.js";
import { composeFailedPlannerResponse, incrementalDelta, usageFromStreamingError } from "./plannerStreamUtils.js";
import { extractAssistantOutputFromJsonLike } from "./plannerTextParsing.js";
import type { DecisionLlmResult, DecisionProcessorDeps, LlmOverrides } from "./types.js";
import { publishConversationUpdated, resolvePlannerModel } from "./context.js";

export function appendThoughtPrepareEntryAndPublish(
  deps: DecisionProcessorDeps,
  input: {
    conversationId: string;
    id: string;
    createdAt: string;
    requestText: string;
    llmModel?: string;
    parentId?: string | null;
  },
): { id: string; conversationIndex: number; createdAt: string } {
  const entry = deps.chatEntries.appendThoughtPrepareEntry(input.conversationId, {
    id: input.id,
    createdAt: input.createdAt,
    requestText: input.requestText,
    llmModel: input.llmModel,
    parentId: input.parentId,
  });
  deps.hub.publish(input.conversationId, {
    type: SseType.CHAT_ENTRY_UPSERT,
    entry,
  });
  return { id: entry.id, conversationIndex: entry.conversationIndex, createdAt: entry.createdAt };
}

export function appendDecisionEntryAndPublishStart(
  deps: DecisionProcessorDeps,
  input: {
    conversationId: string;
    id: string;
    createdAt: string;
    llmRequest: string;
    llmModel?: string;
    parentId?: string | null;
  },
): { id: string; conversationIndex: number; createdAt: string; llmRequest: string; llmModel?: string } {
  const entry = deps.chatEntries.appendPlannerLlmStreamEntry(input.conversationId, {
    id: input.id,
    createdAt: input.createdAt,
    parentId: input.parentId,
    llmRequest: input.llmRequest,
    llmResponse: "",
    thoughtMs: null,
    decision: null,
    status: "running",
    llmModel: input.llmModel,
  });
  deps.hub.publish(input.conversationId, {
    type: SseType.PLANNER_STARTING,
    chatEntryId: entry.id,
    conversationIndex: entry.conversationIndex,
    createdAt: entry.createdAt,
    requestText: entry.llmRequest,
    llmModel: entry.llmModel,
  });
  return entry;
}

export function appendThoughtActionEntryAndPublish(
  deps: DecisionProcessorDeps,
  input: {
    conversationId: string;
    id: string;
    createdAt: string;
    parentId?: string | null;
    status: "running" | "completed" | "failed" | "cancelled";
    summary?: string;
    action?: string;
    toolName?: string;
    error?: string;
    parseResult?: ThoughtActionEntry["parseResult"];
  },
): { id: string; conversationIndex: number; createdAt: string } {
  const entry = deps.chatEntries.appendThoughtActionEntry(input.conversationId, {
    id: input.id,
    createdAt: input.createdAt,
    parentId: input.parentId,
    status: input.status,
    summary: input.summary,
    action: input.action,
    toolName: input.toolName,
    error: input.error,
    parseResult: input.parseResult,
  });
  deps.hub.publish(input.conversationId, {
    type: SseType.CHAT_ENTRY_UPSERT,
    entry,
  });
  return { id: entry.id, conversationIndex: entry.conversationIndex, createdAt: entry.createdAt };
}

export function updateThoughtActionEntryAndPublish(
  deps: DecisionProcessorDeps,
  input: {
    conversationId: string;
    id: string;
    status: "running" | "completed" | "failed" | "cancelled";
    summary?: string;
    action?: string;
    toolName?: string;
    error?: string;
    parseResult?: ThoughtActionEntry["parseResult"];
  },
): void {
  deps.chatEntries.updateThoughtActionEntry(input.conversationId, {
    id: input.id,
    status: input.status,
    summary: input.summary,
    action: input.action,
    toolName: input.toolName,
    error: input.error,
    parseResult: input.parseResult,
  });
  const updated = deps.chatEntries.getMessage(input.conversationId, input.id);
  if (!updated) return;
  deps.hub.publish(input.conversationId, {
    type: SseType.CHAT_ENTRY_UPSERT,
    entry: updated,
  });
}

export function publishDecisionThoughtDelta(
  deps: DecisionProcessorDeps,
  input: { conversationId: string; plannerEntryId: string; delta: string },
): void {
  if (!input.delta) return;
  deps.hub.publish(input.conversationId, {
    type: SseType.PLANNER_LLM_STREAM,
    chatEntryId: input.plannerEntryId,
    delta: input.delta,
  });
}

export async function callLlmStreaming(
  deps: DecisionProcessorDeps,
  prompt: string,
  overrides: LlmOverrides,
  requestParams: Record<string, unknown>,
  files: Array<{ filename: string; mimeType: string; base64Data: string }>,
  onDelta: (delta: string) => void,
): Promise<StreamTextCompletionResult> {
  const doc = deps.llmProviderSettings.getDocument();
  const providerId = String(overrides.llmProviderId || doc.llm_configuration.provider_id || "openai");
  const model = resolvePlannerModel(deps, overrides);
  const provider = deps.llmProviderSettings.getProvider(providerId);
  if (!provider) throw new Error(`unknown provider: ${providerId}`);
  const providerSettings = deps.llmProviderSettings.getProviderSettings(providerId);
  if (!providerSettings) throw new Error(`provider settings not found: ${providerId}`);

  logger.info({ providerId, model, promptChars: prompt.length }, "[llm] request formatted");
  logger.info({ providerId, model }, "[llm] sending request");
  const requestSentAtMs = Date.now();
  let firstTokenLogged = false;
  const result = await provider.streamTextCompletion(
    providerSettings,
    { model, prompt, requestParams, files },
    (delta) => {
      if (!firstTokenLogged) {
        firstTokenLogged = true;
        logger.info(
          { providerId, model, firstTokenLatencyMs: Math.max(0, Date.now() - requestSentAtMs) },
          "[llm] first token received",
        );
      }
      onDelta(delta);
    },
  );
  logger.info(
    { providerId, model, responseChars: result.text.length, usage: result.usage ?? null },
    "[llm] completion finished",
  );
  return result;
}

export async function getDecisionLlmResponse(
  deps: DecisionProcessorDeps,
  input: {
    conversationId: string;
    requestText: string;
    plannerLlmModel: string;
    parentId?: string | null;
    llmOverrides: LlmOverrides;
    requestParams: Record<string, unknown>;
    files: Array<{ filename: string; mimeType: string; base64Data: string }>;
    shouldCancel?: () => boolean;
  },
): Promise<DecisionLlmResult> {
  const plannerEntryId = crypto.randomUUID();
  const thoughtActionEntryId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const requestStartedMs = Date.now();
  appendDecisionEntryAndPublishStart(deps, {
    conversationId: input.conversationId,
    id: plannerEntryId,
    createdAt,
    parentId: input.parentId,
    llmRequest: input.requestText,
    llmModel: input.plannerLlmModel,
  });
  appendThoughtActionEntryAndPublish(deps, {
    conversationId: input.conversationId,
    id: thoughtActionEntryId,
    createdAt,
    parentId: plannerEntryId,
    status: "running",
    summary: "Waiting for planner output",
  });

  let reply = "";
  let firstDeltaPublished = false;
  let plannerText = "";
  let streamedAnswer = "";
  let assistantEntryId: string | null = null;
  let reconstructedReply = "";
  let plannerTokenUsage: StreamTextCompletionResult["usage"];
  try {
    const completion = await callLlmStreaming(
      deps,
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
        const thoughtDelta = incrementalDelta(plannerText, reconstructedReply);
        publishDecisionThoughtDelta(deps, {
          conversationId: input.conversationId,
          plannerEntryId,
          delta: thoughtDelta,
        });
        plannerText = reconstructedReply;

        const streamedAssistantOutput = extractAssistantOutputFromJsonLike(reconstructedReply);
        const answerDelta = incrementalDelta(streamedAnswer, streamedAssistantOutput);
        if (answerDelta) {
          if (!assistantEntryId) {
            assistantEntryId = crypto.randomUUID();
            deps.chatEntries.appendAssistantMessage(input.conversationId, "", { id: assistantEntryId });
          }
          deps.hub.publish(input.conversationId, {
            type: SseType.ASSISTANT_STREAM,
            chatEntryId: assistantEntryId,
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
      deps.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
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
      publishConversationUpdated(deps, input.conversationId);
      deps.hub.publish(input.conversationId, {
        type: SseType.PLANNER_RESPONSE,
        chatEntryId: plannerEntryId,
        summary: "Cancelled",
        finished: true,
        action: "cancelled",
        llmModel: input.plannerLlmModel,
        ...TokenUsageMapper.toSseFields(plannerTokenUsage),
      });
      updateThoughtActionEntryAndPublish(deps, {
        conversationId: input.conversationId,
        id: thoughtActionEntryId,
        status: "cancelled",
        summary: "Cancelled",
        action: "cancelled",
        error: detail,
      });
      return { kind: "cancelled" };
    }
    const detail = e instanceof Error ? e.message : String(e);
    deps.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
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
    publishConversationUpdated(deps, input.conversationId);
    deps.hub.publish(input.conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chatEntryId: plannerEntryId,
      summary: detail,
      finished: true,
      action: "failed",
      llmModel: input.plannerLlmModel,
      ...TokenUsageMapper.toSseFields(plannerTokenUsage),
    });
    updateThoughtActionEntryAndPublish(deps, {
      conversationId: input.conversationId,
      id: thoughtActionEntryId,
      status: "failed",
      summary: detail,
      action: "failed",
      error: detail,
    });
    throw e;
  }

  return {
    kind: "ok",
    plannerEntryId,
    thoughtActionEntryId,
    assistantEntryId,
    reply,
    streamedAnswer,
    plannerTokenUsage,
    requestStartedMs,
  };
}
