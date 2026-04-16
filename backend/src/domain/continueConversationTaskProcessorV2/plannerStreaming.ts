import { logger } from "../../infra/logger.js";
import type { StreamTextCompletionResult } from "../../llm_provider/provider.js";
import { SseType } from "../../types/sse.js";
import { TokenUsageMapper } from "../../types/tokenUsage.js";
import { isTaskCancelledError, throwIfCancelled } from "../taskCancellation.js";
import {
  composeFailedPlannerResponse,
  extractAssistantOutputFromJsonLike,
  incrementalDelta,
  usageFromStreamingError,
} from "../continueConversationTaskProcessor.helpers.js";
import type { ContinueConversationProcessorDeps, LlmOverrides, PlannerLlmResult } from "./types.js";
import { publishConversationUpdated, resolvePlannerModel } from "./context.js";

export function appendPlannerEntryAndPublishStart(
  deps: ContinueConversationProcessorDeps,
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

export function publishPlannerThoughtDelta(
  deps: ContinueConversationProcessorDeps,
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
  deps: ContinueConversationProcessorDeps,
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

export async function getPlannerLlmResponse(
  deps: ContinueConversationProcessorDeps,
  input: {
    conversationId: string;
    requestText: string;
    plannerLlmModel: string;
    llmOverrides: LlmOverrides;
    requestParams: Record<string, unknown>;
    files: Array<{ filename: string; mimeType: string; base64Data: string }>;
    shouldCancel?: () => boolean;
  },
): Promise<PlannerLlmResult> {
  const plannerEntryId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const requestStartedMs = Date.now();
  appendPlannerEntryAndPublishStart(deps, {
    conversationId: input.conversationId,
    id: plannerEntryId,
    createdAt,
    llmRequest: input.requestText,
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
        publishPlannerThoughtDelta(deps, {
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
