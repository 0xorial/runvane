import { resolveThoughtTypeProvider, type AnyThoughtTypeProvider } from "../thoughtTypeProviders/index.js";
import type { DecisionStepInput, ReasonStepInput } from "../types.js";
import { runDecisionStep } from "./decisionStep.js";
import { getThoughtRuntimeDeps } from "./runtimeDeps.js";
import { createStepHandle } from "./stepHandle.js";
import { SseType } from "../../../types/sse.js";
import type { PlannerLlmStreamEntry } from "../../../types/chatEntry.js";
import { isTaskCancelledError, throwIfCancelled } from "../../taskCancellation.js";
import { updateThoughtActionEntryAndPublish } from "../../thoughtLifecycle.js";
import { TokenUsageMapper } from "../../../types/tokenUsage.js";

export async function runReasonStep(input: ReasonStepInput, opts?: { shouldCancel?: () => boolean }): Promise<void> {
  const provider = resolveThoughtTypeProvider(input.thought.thoughtType);
  const step = await createStepHandle("reason", input.thought);
  const decisionInput = await provider.runReason(step, input);
  try {
    throwIfCancelled(opts?.shouldCancel);
    const runtimeDecisionInput = await executeReasonRuntime(provider, decisionInput, opts);
    throwIfCancelled(opts?.shouldCancel);
    await runDecisionStep(runtimeDecisionInput, opts);
  } catch (error) {
    if (!isTaskCancelledError(error)) throw error;
    persistReasonCancellation(input.thought.thoughtType, decisionInput);
    return;
  }
}

async function executeReasonRuntime(
  provider: AnyThoughtTypeProvider,
  decisionInput: DecisionStepInput,
  opts?: { shouldCancel?: () => boolean },
): Promise<DecisionStepInput> {
  const request = provider.getReasonLlmRequest?.(decisionInput);
  if (!request) return decisionInput;
  const deps = getThoughtRuntimeDeps();
  throwIfCancelled(opts?.shouldCancel);
  const doc = deps.llmProviderSettings.getDocument();
  const { provider_id: providerId, model_name: model } = doc.llm_configuration;
  const llmProvider = deps.llmProviderSettings.getProvider(providerId);
  const providerSettings = deps.llmProviderSettings.getProviderSettings(providerId);
  if (!llmProvider || !providerSettings) {
    return provider.applyReasonLlmResult
      ? provider.applyReasonLlmResult(decisionInput, { fullResponse: "", providerId, model })
      : decisionInput;
  }
  let streamedResponse = "";
  const completion = await llmProvider.streamTextCompletion(
    providerSettings,
    { model, prompt: request.prompt },
    (delta) => {
      throwIfCancelled(opts?.shouldCancel);
      streamedResponse += delta;
      provider.onReasonLlmDelta?.(decisionInput, delta);
    },
  );
  throwIfCancelled(opts?.shouldCancel);
  if (!provider.applyReasonLlmResult) return decisionInput;
  return provider.applyReasonLlmResult(decisionInput, {
    fullResponse: String(completion.text || streamedResponse),
    providerId,
    model,
    ...(completion.usage ? { usage: completion.usage } : {}),
  });
}

export async function reprocessPlannerReasonStep(input: {
  conversationId: string;
  sourceEntryId: string;
  editedResponse: string;
  enabledToolIds: string[];
  shouldCancel?: () => boolean;
}): Promise<{ plannerEntryId: string; queuedToolCalls: number }> {
  throwIfCancelled(input.shouldCancel);
  const deps = getThoughtRuntimeDeps();
  const sourceEntry = deps.chatEntries.getMessage(input.conversationId, input.sourceEntryId);
  if (!sourceEntry || sourceEntry.type !== "planner_llm_stream") {
    throw new Error(`planner thought not found: ${input.sourceEntryId}`);
  }
  const editedResponse = input.editedResponse.trim();
  if (!editedResponse) throw new Error("editedResponse is required");
  const plannerEntry = deps.chatEntries.appendPlannerLlmStreamEntry(input.conversationId, {
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
  publishPlannerStarting(input.conversationId, plannerEntry, deps.hub);
  deps.hub.publish(input.conversationId, {
    type: SseType.PLANNER_LLM_STREAM,
    chatEntryId: plannerEntry.id,
    delta: editedResponse,
  });
  throwIfCancelled(input.shouldCancel);
  await runDecisionStep({
    thought: {
      thoughtType: "planner",
      thoughtId: plannerEntry.thoughtId,
      conversationId: input.conversationId,
      streamEntryId: plannerEntry.id,
    },
    reasonOutput: {
      conversationId: input.conversationId,
      streamEntryId: plannerEntry.id,
      thoughtActionEntryId: null,
      prompt: plannerEntry.llmRequest,
      enabledToolIds: input.enabledToolIds,
      requestStartedMs: Date.parse(plannerEntry.createdAt),
      result: {
        fullResponse: editedResponse,
        ...(plannerEntry.llmProviderId ? { providerId: plannerEntry.llmProviderId } : {}),
        ...(plannerEntry.llmModel ? { model: plannerEntry.llmModel } : {}),
      },
    },
  } as DecisionStepInput<any, any>, { shouldCancel: input.shouldCancel });
  const persisted = deps.chatEntries.getMessage(input.conversationId, plannerEntry.id);
  const queuedToolCalls =
    persisted?.type === "planner_llm_stream" && persisted.parseResult?.status === "ok"
      ? persisted.parseResult.parsed.tool_requests.length
      : 0;
  return {
    plannerEntryId: plannerEntry.id,
    queuedToolCalls,
  };
}

function publishPlannerStarting(
  conversationId: string,
  plannerEntry: PlannerLlmStreamEntry,
  hub: ReturnType<typeof getThoughtRuntimeDeps>["hub"],
): void {
  const { id: chatEntryId, llmRequest: requestText, ...entry } = plannerEntry;
  hub.publish(conversationId, {
    ...entry,
    type: SseType.PLANNER_STARTING,
    chatEntryId,
    requestText,
  });
}

function persistReasonCancellation(thoughtType: string, decisionInput: DecisionStepInput): void {
  const reason = decisionInput.reasonOutput as {
    conversationId?: string;
    streamEntryId?: string;
    thoughtActionEntryId?: string | null;
    prompt?: string;
    requestStartedMs?: number;
  };
  if (!reason.conversationId || !reason.streamEntryId || !reason.prompt) return;
  const deps = getThoughtRuntimeDeps();
  const thoughtMs = Math.max(0, Date.now() - (reason.requestStartedMs ?? Date.now()));
  if (thoughtType === "autoTitle") {
    deps.chatEntries.updateTitleLlmStreamEntry(reason.conversationId, {
      id: reason.streamEntryId,
      llmRequest: reason.prompt,
      llmResponse: "",
      thoughtMs,
      decision: null,
      status: "cancelled",
      error: "task cancelled by user",
    });
    deps.hub.publish(reason.conversationId, {
      type: SseType.TITLE_RESPONSE,
      chatEntryId: reason.streamEntryId,
      summary: "Cancelled",
      finished: true,
      action: "cancelled",
      ...TokenUsageMapper.toSseFields(undefined),
    });
  } else {
    deps.chatEntries.updatePlannerLlmStreamEntry(reason.conversationId, {
      id: reason.streamEntryId,
      llmRequest: reason.prompt,
      llmResponse: "",
      thoughtMs,
      decision: null,
      status: "cancelled",
      error: "task cancelled by user",
      parseResult: {
        status: "error",
        error: "task cancelled by user",
      },
    });
    deps.hub.publish(reason.conversationId, {
      type: SseType.PLANNER_RESPONSE,
      chatEntryId: reason.streamEntryId,
      summary: "Cancelled",
      finished: true,
      action: "cancelled",
      ...TokenUsageMapper.toSseFields(undefined),
    });
  }
  if (reason.thoughtActionEntryId) {
    updateThoughtActionEntryAndPublish(
      { chatEntries: deps.chatEntries, hub: deps.hub },
      {
        conversationId: reason.conversationId,
        id: reason.thoughtActionEntryId,
        status: "cancelled",
        summary: "Cancelled",
        action: "cancelled",
        error: "task cancelled by user",
      },
    );
  }
}
