import { startThoughtLifecycle } from "../../thoughtLifecycle.js";
import { throwIfCancelled } from "../../taskCancellation.js";
import type { PrepareStepInput, ReasonStepInput, ThoughtTypeProvider, ThoughtTypeProvider2 } from "../types.js";
import type { PlannerPrepareOutput, PlannerThought } from "../thoughtTypeProviders/plannerProvider.js";
import { runReasonStep } from "./reasonStep.js";
import { getThoughtRuntimeDeps, type ThoughtRuntimeDeps } from "./runtimeDeps.js";
import { resolvePlannerReprocessContext } from "./reprocessPlannerContext.js";
import { createStepHandle } from "./stepHandle.js";
import type { ConversationEventHub } from "../../../events/conversationEventHub.js";
import type {
  ChatEntryPayloadByType,
  ChatEntriesRepo,
  ChatEntryDbRow,
} from "../../../infra/repositories/chatEntriesRepo.js";
import { parseJsonObject } from "../../../infra/repositories/json.js";
import { SseType } from "../../../types/sse.js";
import type { ChatEntry } from "../../../types/chatEntry.js";

type PrepareStepInput = {
  conversationId: string;
  thoughtId: string;
};

type PrepareStepDeps = {
  chatEntries: ChatEntriesRepo;
  hub: ConversationEventHub;
};

// thought entries must be pre-created before calling this
export async function runPrepareStep(
  input: PrepareStepInput,
  provider: ThoughtTypeProvider2,
  signal: AbortSignal,
  deps: PrepareStepDeps
): Promise<void> {
  // try to see if "thought" already exists, meaning there are entries with the same thoughtId
  const thoughtEntries = deps.chatEntries.getThoughtEntries(input.conversationId, input.thoughtId);
  const prepareEntry = thoughtEntries.find(
    (entry): entry is ChatEntryDbRow<"thought-prepare"> => entry.type === "thought-prepare"
  );
  if (!prepareEntry) {
    throw new Error(`prepare entry not found for thought: ${input.thoughtId}`);
  }
  deps.chatEntries.setEntryStatus(input.conversationId, prepareEntry.id, "running");
  deps.hub.publish(input.conversationId, {
    type: SseType.THOUGHT_PREPARE_STEP_STARTING,
    chatEntryId: prepareEntry.id,
  });
  const currentJsonPayload = parseEntryPayload(prepareEntry, "thought-prepare");
  try {
    const reasonInput = await provider.runPrepare({ prepareEntry }, signal);
    deps.hub.publish(input.conversationId, {
      type: SseType.THOUGHT_PREPARE_STEP_FINISHED,
      chatEntryId: prepareEntry.id,
      preparedReasonStepInput: reasonInput.preparedReasonStepInput,
    });
    deps.chatEntries.setEntryStatus(input.conversationId, prepareEntry.id, "completed");
    deps.chatEntries.setEntryPayload(input.conversationId, prepareEntry.id, {
      ...currentJsonPayload,
      preparedReasonStepInput: reasonInput.preparedReasonStepInput,
    });
    signal.throwIfAborted();
    await runReasonStep(reasonInput);
  } catch (error) {
    if (isAbortLikeError(error, signal)) {
      deps.chatEntries.setEntryStatus(input.conversationId, prepareEntry.id, "cancelled");
      deps.hub.publish(input.conversationId, {
        type: SseType.THOUGHT_PREPARE_STEP_CANCELLED,
        chatEntryId: prepareEntry.id,
      });
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    deps.chatEntries.setEntryStatus(input.conversationId, prepareEntry.id, "failed");
    deps.hub.publish(input.conversationId, {
      type: SseType.THOUGHT_PREPARE_STEP_FAILED,
      chatEntryId: prepareEntry.id,
      error: detail,
    });
    throw error;
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
  switch (expectedType) {
    case "thought-prepare": {
      if (typeof payload.requestText !== "string") {
        throw new Error(`invalid thought-prepare payload: requestText missing (${entry.id})`);
      }
      if (typeof payload.thoughtId !== "string" || payload.thoughtId.trim() === "") {
        throw new Error(`invalid thought-prepare payload: thoughtId missing (${entry.id})`);
      }
      return payload as ChatEntryPayloadByType[TType];
    }
    default:
      return payload as ChatEntryPayloadByType[TType];
  }
}

function isAbortLikeError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

export async function reprocessPlannerPrepareStep(input: {
  conversationId: string;
  sourceEntryId: string;
  editedRequestText: string;
  llmProviderId: string;
  llmModel: string;
  signal?: AbortSignal;
}): Promise<{ plannerEntryId: string; queuedToolCalls: number }> {
  throwIfCancelled(input.signal);
  const deps = getThoughtRuntimeDeps();
  const { sourceEntry, anchorUserMessage, enabledToolIds } = resolvePlannerReprocessContext({
    conversationId: input.conversationId,
    sourceEntryId: input.sourceEntryId,
  });
  const editedRequestText = input.editedRequestText.trim();
  if (!editedRequestText) throw new Error("editedRequestText is required");
  const previousPrepareEntry = sourceEntry.parentId
    ? deps.chatEntries.getMessage(input.conversationId, sourceEntry.parentId)
    : null;
  const prepareParentId =
    previousPrepareEntry && previousPrepareEntry.type === "thought-prepare"
      ? previousPrepareEntry.parentId
      : sourceEntry.parentId;
  const started = startThoughtLifecycle(
    { chatEntries: deps.chatEntries, hub: deps.hub },
    {
      conversationId: input.conversationId,
      parentId: prepareParentId,
      llmRequest: editedRequestText,
      llmProviderId: input.llmProviderId,
      llmModel: input.llmModel,
      kind: "planner",
      includeAction: true,
      summary: "Call preparation",
    }
  );
  throwIfCancelled(input.signal);
  const reasonInput: ReasonStepInput<PlannerPrepareOutput, PlannerThought> = {
    thought: {
      thoughtType: "planner",
      thoughtId: started.streamEntry.thoughtId,
      conversationId: input.conversationId,
      streamEntryId: started.streamEntry.id,
      thoughtActionEntryId: started.thoughtActionEntry.id,
    },
    prepareOutput: {
      conversationId: input.conversationId,
      streamEntryId: started.streamEntry.id,
      thoughtActionEntryId: started.thoughtActionEntry.id,
      agentId: anchorUserMessage.agentId,
      userText: anchorUserMessage.text,
      llmRequest: editedRequestText,
      enabledToolIds,
    },
  };
  await runReasonStep(reasonInput, { signal: input.signal });
  const persisted = deps.chatEntries.getMessage(input.conversationId, started.streamEntry.id);
  const queuedToolCalls =
    persisted?.type === "planner_llm_stream" && persisted.parseResult?.status === "ok"
      ? persisted.parseResult.parsed.tool_requests.length
      : 0;
  return {
    plannerEntryId: started.streamEntry.id,
    queuedToolCalls,
  };
}
