import { logger } from "../../infra/logger.js";
import type { StreamTextCompletionResult } from "../../llm_provider/provider.js";
import { SseType } from "../../types/sse.js";
import { TokenUsageMapper } from "../../types/tokenUsage.js";
import { updateThoughtActionEntryAndPublish } from "../thoughtLifecycle.js";
import { isTaskCancelledError, throwIfCancelled } from "../taskCancellation.js";
import { composeFailedPlannerResponse, incrementalDelta, usageFromStreamingError } from "./plannerStreamUtils.js";
import { extractAssistantOutputFromJsonLike } from "./plannerTextParsing.js";
import type { DecisionLlmResult, DecisionProcessorDeps, LlmOverrides } from "./types.js";
import { publishConversationUpdated, resolvePlannerModel, resolvePlannerProviderId } from "./context.js";

function extractErrorCauseDetail(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause == null) return null;
  if (cause instanceof Error) return cause.message.trim() || null;
  if (typeof cause === "string") {
    const trimmed = cause.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof cause === "object" && !Array.isArray(cause)) {
    const rec = cause as {
      code?: unknown;
      errno?: unknown;
      syscall?: unknown;
      address?: unknown;
      port?: unknown;
      message?: unknown;
    };
    const parts: string[] = [];
    if (typeof rec.code === "string" && rec.code.trim()) parts.push(rec.code.trim());
    if (typeof rec.errno === "number" && Number.isFinite(rec.errno)) parts.push(`errno=${Math.trunc(rec.errno)}`);
    if (typeof rec.syscall === "string" && rec.syscall.trim()) parts.push(`syscall=${rec.syscall.trim()}`);
    if (typeof rec.address === "string" && rec.address.trim()) parts.push(`address=${rec.address.trim()}`);
    if (typeof rec.port === "number" && Number.isFinite(rec.port)) parts.push(`port=${Math.trunc(rec.port)}`);
    if (typeof rec.message === "string" && rec.message.trim()) parts.push(rec.message.trim());
    if (parts.length > 0) return parts.join(" ");
  }
  const fallback = String(cause).trim();
  return fallback.length > 0 ? fallback : null;
}

function formatPlannerErrorDetail(
  deps: DecisionProcessorDeps,
  input: { llmOverrides: LlmOverrides; plannerLlmModel: string },
  error: unknown,
): string {
  const rawDetail = error instanceof Error ? error.message : String(error);
  const causeDetail = extractErrorCauseDetail(error);
  if (rawDetail !== "fetch failed") {
    if (causeDetail && !rawDetail.includes(causeDetail)) return `${rawDetail} (cause: ${causeDetail})`;
    return rawDetail;
  }
  const doc = deps.llmProviderSettings.getDocument();
  const providerId = String(input.llmOverrides.llmProviderId || doc.llm_configuration.provider_id || "openai");
  const provider = deps.llmProviderSettings.getProvider(providerId);
  const providerLabel = provider?.label || providerId;
  const providerSettings = deps.llmProviderSettings.getProviderSettings(providerId);
  const baseUrl = String(providerSettings?.base_url ?? "").trim();
  const baseUrlPart = baseUrl ? ` base_url=${baseUrl}.` : "";
  const causePart = causeDetail ? ` cause=${causeDetail}.` : "";
  return `LLM request failed to reach provider ${providerLabel} (${providerId}) using model ${input.plannerLlmModel}.${baseUrlPart}${causePart}`.trim();
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
    plannerEntryId: string;
    thoughtActionEntryId: string;
    requestStartedMs: number;
    requestText: string;
    plannerLlmModel: string;
    llmOverrides: LlmOverrides;
    requestParams: Record<string, unknown>;
    files: Array<{ filename: string; mimeType: string; base64Data: string }>;
    shouldCancel?: () => boolean;
  },
): Promise<DecisionLlmResult> {
  const plannerLlmProviderId = resolvePlannerProviderId(deps, input.llmOverrides);
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
              plannerEntryId: input.plannerEntryId,
              firstStreamLatencyMs: Math.max(0, Date.now() - input.requestStartedMs),
            },
            "[sse] first llm token streamed",
          );
        }
        reconstructedReply += delta;
        const thoughtDelta = incrementalDelta(plannerText, reconstructedReply);
        publishDecisionThoughtDelta(deps, {
          conversationId: input.conversationId,
          plannerEntryId: input.plannerEntryId,
          delta: thoughtDelta,
        });
        plannerText = reconstructedReply;

        const streamedAssistantOutput = extractAssistantOutputFromJsonLike(reconstructedReply);
        const answerDelta = incrementalDelta(streamedAnswer, streamedAssistantOutput);
        if (answerDelta) {
          if (!assistantEntryId) {
            assistantEntryId = crypto.randomUUID();
            deps.chatEntries.appendAssistantMessage(input.conversationId, "", {
              id: assistantEntryId,
              // Keep streamed assistant output on the same planner branch.
              parentId: input.thoughtActionEntryId,
            });
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
        id: input.plannerEntryId,
        llmRequest: input.requestText,
        llmResponse: composeFailedPlannerResponse(reconstructedReply),
        thoughtMs: Math.max(0, Date.now() - input.requestStartedMs),
        decision: null,
        status: "cancelled",
        error: detail,
        llmProviderId: plannerLlmProviderId,
        llmModel: input.plannerLlmModel,
        ...TokenUsageMapper.toEntryFields(plannerTokenUsage),
      });
      publishConversationUpdated(deps, input.conversationId);
      deps.hub.publish(input.conversationId, {
        type: SseType.PLANNER_RESPONSE,
        chatEntryId: input.plannerEntryId,
        summary: "Cancelled",
        finished: true,
        action: "cancelled",
        llmProviderId: plannerLlmProviderId,
        llmModel: input.plannerLlmModel,
        ...TokenUsageMapper.toSseFields(plannerTokenUsage),
      });
      updateThoughtActionEntryAndPublish(deps, {
        conversationId: input.conversationId,
        id: input.thoughtActionEntryId,
        status: "cancelled",
        summary: "Cancelled",
        action: "cancelled",
        error: detail,
      });
      return { kind: "cancelled" };
    }
    const detail = formatPlannerErrorDetail(
      deps,
      { llmOverrides: input.llmOverrides, plannerLlmModel: input.plannerLlmModel },
      e,
    );
    deps.chatEntries.updatePlannerLlmStreamEntry(input.conversationId, {
      id: input.plannerEntryId,
      llmRequest: input.requestText,
      llmResponse: composeFailedPlannerResponse(reconstructedReply),
      thoughtMs: Math.max(0, Date.now() - input.requestStartedMs),
      decision: null,
      status: "failed",
      error: detail,
      llmProviderId: plannerLlmProviderId,
      llmModel: input.plannerLlmModel,
      ...TokenUsageMapper.toEntryFields(plannerTokenUsage),
    });
    publishConversationUpdated(deps, input.conversationId);
    deps.hub.publish(input.conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chatEntryId: input.plannerEntryId,
      summary: detail,
      finished: true,
      action: "failed",
      llmProviderId: plannerLlmProviderId,
      llmModel: input.plannerLlmModel,
      ...TokenUsageMapper.toSseFields(plannerTokenUsage),
    });
    updateThoughtActionEntryAndPublish(deps, {
      conversationId: input.conversationId,
      id: input.thoughtActionEntryId,
      status: "failed",
      summary: detail,
      action: "failed",
      error: detail,
    });
    throw e;
  }

  return {
    kind: "ok",
    plannerEntryId: input.plannerEntryId,
    thoughtActionEntryId: input.thoughtActionEntryId,
    assistantEntryId,
    reply,
    streamedAnswer,
    plannerTokenUsage,
    requestStartedMs: input.requestStartedMs,
  };
}
