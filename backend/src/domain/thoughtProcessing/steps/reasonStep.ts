import { resolveThoughtTypeProvider, type AnyThoughtTypeProvider } from "../thoughtTypeProviders/index.js";
import type {
  DecisionStepInput,
  DecisionStepInput2,
  ReasonStepInput,
  ReasonStepInput2,
  ThoughtTypeProvider2,
} from "../types.js";
import { runDecisionStep, runDecisionStep2 } from "./decisionStep.js";
import { getThoughtRuntimeDeps, type ThoughtRuntimeDeps } from "./runtimeDeps.js";
import { createStepHandle } from "./stepHandle.js";
import { SseType } from "../../../types/sse.js";
import type { ChatEntry, PlannerLlmStreamEntry } from "../../../types/chatEntry.js";
import { isTaskCancelledError, throwIfCancelled } from "../../taskCancellation.js";
import { updateThoughtActionEntryAndPublish } from "../../thoughtLifecycle.js";
import { TokenUsageMapper } from "../../../types/tokenUsage.js";
import { resolvePlannerReprocessContext } from "./reprocessPlannerContext.js";
import type {
  ChatEntriesRepo,
  ChatEntryDbRow,
  ChatEntryPayloadByType,
} from "../../../infra/repositories/chatEntriesRepo.js";
import { parseJsonObject } from "../../../infra/repositories/json.js";
import type { ConversationEventHub } from "../../../events/conversationEventHub.js";

export type ReasonStepDeps = {
  chatEntries: ChatEntriesRepo;
  hub: ConversationEventHub;
};

export async function runReasonStep2(
  input: ReasonStepInput2,
  provider: ThoughtTypeProvider2,
  signal: AbortSignal,
  deps: ReasonStepDeps
): Promise<void> {
  const thoughtEntries = deps.chatEntries.getThoughtEntries(input.conversationId, input.thoughtId);
  const reasonEntry = thoughtEntries.single(
    (entry): entry is ChatEntryDbRow<"planner_llm_stream" | "title_llm_stream"> =>
      entry.type === "planner_llm_stream" || entry.type === "title_llm_stream"
  );

  deps.chatEntries.setEntryStatus(input.conversationId, reasonEntry.id, "running");
  deps.hub.publish(input.conversationId, {
    type: SseType.THOUGHT_REASON_STEP_STARTING,
    chatEntryId: reasonEntry.id,
  });
  const currentJsonPayload = parseEntryPayload(reasonEntry, reasonEntry.type);
  let decisionInput: DecisionStepInput2;
  try {
    await executeReasonRuntime(provider, decisionInput, opts);
    deps.hub.publish(input.conversationId, {
      type: SseType.THOUGHT_REASON_STEP_FINISHED,
      chatEntryId: reasonEntry.id,
      preparedDecisionStepInput: decisionInput.preparedDecisionStepInput,
    });
    deps.chatEntries.setEntryStatus(input.conversationId, reasonEntry.id, "completed");
    deps.chatEntries.setEntryPayload(input.conversationId, reasonEntry.id, {
      ...currentJsonPayload,
      preparedDecisionStepInput: decisionInput.preparedDecisionStepInput,
    });
    signal.throwIfAborted();
  } catch (error) {
    if (isAbortLikeError(error, signal)) {
      deps.chatEntries.setEntryStatus(input.conversationId, reasonEntry.id, "cancelled");
      deps.hub.publish(input.conversationId, {
        type: SseType.THOUGHT_REASON_STEP_CANCELLED,
        chatEntryId: reasonEntry.id,
      });
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    deps.chatEntries.setEntryStatus(input.conversationId, reasonEntry.id, "failed");
    deps.hub.publish(input.conversationId, {
      type: SseType.THOUGHT_REASON_STEP_FAILED,
      chatEntryId: reasonEntry.id,
      error: detail,
    });
    throw error;
  }
  await runDecisionStep2(decisionInput, provider, signal);
}

export async function runReasonStep(input: ReasonStepInput, opts?: { signal?: AbortSignal }): Promise<void> {
  const provider = resolveThoughtTypeProvider(input.thought.thoughtType);
  const step = await createStepHandle("reason", input.thought);
  const decisionInput = await provider.runReason(step, input);
  await runReasonDecisionPhase(input.thought.thoughtType, provider, decisionInput, opts, { executeRuntime: true });
}

async function runReasonDecisionPhase(
  thoughtType: string,
  provider: AnyThoughtTypeProvider,
  decisionInput: DecisionStepInput,
  opts?: { signal?: AbortSignal },
  cfg?: { executeRuntime?: boolean }
): Promise<void> {
  try {
    throwIfCancelled(opts?.signal);
    const runtimeDecisionInput =
      cfg?.executeRuntime === false ? decisionInput : await executeReasonRuntime(provider, decisionInput, opts);
    throwIfCancelled(opts?.signal);
    await runDecisionStep(runtimeDecisionInput, opts);
  } catch (error) {
    if (!isTaskCancelledError(error)) throw error;
    persistReasonCancellation(thoughtType, decisionInput);
    return;
  }
}

async function buildLlmProvider(): Promise<LlmProvider> {
  const deps = getThoughtRuntimeDeps();
  const llmProvider = assertNotNull(deps.llmProviderSettings.getProvider(providerId));
  return llmProvider;
}

async function executeReasonRuntime(
  provider: ThoughtTypeProvider2,
  decisionInput: DecisionStepInput,
  deps: ThoughtRuntimeDeps,
  signal: AbortSignal
): Promise<DecisionStepInput> {
  const doc = deps.llmProviderSettings.getDocument();
  const { provider_id: providerId, model_name: model } = doc.llm_configuration;
  const llmProvider = assertNotNull(deps.llmProviderSettings.getProvider(providerId));
  const providerSettings = assertNotNull(deps.llmProviderSettings.getProviderSettings(providerId));
  let streamedResponse = "";
  const completion = await llmProvider.streamTextCompletion(
    providerSettings,
    { model, prompt: request.prompt },
    (delta) => {
      throwIfCancelled(opts?.signal);
      streamedResponse += delta;
      provider.onReasonLlmDelta?.(decisionInput, delta);
    }
  );
  throwIfCancelled(opts?.signal);
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
  signal?: AbortSignal;
}): Promise<{ plannerEntryId: string; queuedToolCalls: number }> {
  throwIfCancelled(input.signal);
  const deps = getThoughtRuntimeDeps();
  const { sourceEntry, anchorUserMessage, enabledToolIds } = resolvePlannerReprocessContext({
    conversationId: input.conversationId,
    sourceEntryId: input.sourceEntryId,
  });
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
  throwIfCancelled(input.signal);
  const provider = resolveThoughtTypeProvider("planner");
  const decisionInput = {
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
      agentId: anchorUserMessage.agentId,
      userText: anchorUserMessage.text,
      prompt: plannerEntry.llmRequest,
      enabledToolIds,
      requestStartedMs: Date.parse(plannerEntry.createdAt),
      result: {
        fullResponse: editedResponse,
        ...(plannerEntry.llmProviderId ? { providerId: plannerEntry.llmProviderId } : {}),
        ...(plannerEntry.llmModel ? { model: plannerEntry.llmModel } : {}),
      },
    },
  } as DecisionStepInput<any, any>;
  await runReasonDecisionPhase(
    "planner",
    provider,
    decisionInput,
    { signal: input.signal },
    {
      executeRuntime: false,
    }
  );
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
  hub: ReturnType<typeof getThoughtRuntimeDeps>["hub"]
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
      }
    );
  }
}

function parseEntryPayload<TType extends ChatEntry["type"]>(
  entry: ChatEntryDbRow,
  expectedType: TType
): ChatEntryPayloadByType[TType] {
  if (entry.type !== expectedType) {
    throw new Error(`entry type mismatch: expected ${expectedType}, got ${entry.type}`);
  }
  const payload = parseJsonObject(entry.payload_json);
  if (typeof payload !== "object" || payload == null || Array.isArray(payload)) {
    throw new Error(`invalid payload json for ${expectedType}: ${entry.id}`);
  }
  return payload as ChatEntryPayloadByType[TType];
}

function isAbortLikeError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

function assertNotNull<T>(value: T | null | undefined, message = "Expected non-null value"): NonNullable<T> {
  if (value == null) {
    throw new Error(message);
  }
  return value;
}
