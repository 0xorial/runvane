import { startThoughtLifecycle } from "../../thoughtLifecycle.js";
import { throwIfCancelled } from "../../taskCancellation.js";
import { resolveThoughtTypeProvider } from "../thoughtTypeProviders/index.js";
import type { PrepareStepInput, ReasonStepInput } from "../types.js";
import { runReasonStep } from "./reasonStep.js";
import { getThoughtRuntimeDeps } from "./runtimeDeps.js";
import { createStepHandle } from "./stepHandle.js";

export async function runPrepareStep(input: PrepareStepInput, opts?: { shouldCancel?: () => boolean }): Promise<void> {
  throwIfCancelled(opts?.shouldCancel);
  const provider = resolveThoughtTypeProvider(input.thought.thoughtType);
  const step = await createStepHandle("prepare", input.thought);
  const reasonInput = await provider.runPrepare(step, input);
  throwIfCancelled(opts?.shouldCancel);
  await runReasonStep(reasonInput, opts);
}

export async function reprocessPlannerPrepareStep(input: {
  conversationId: string;
  sourceEntryId: string;
  editedRequestText: string;
  llmProviderId: string;
  llmModel: string;
  enabledToolIds: string[];
  shouldCancel?: () => boolean;
}): Promise<{ plannerEntryId: string; queuedToolCalls: number }> {
  throwIfCancelled(input.shouldCancel);
  const deps = getThoughtRuntimeDeps();
  const sourceEntry = deps.chatEntries.getMessage(input.conversationId, input.sourceEntryId);
  if (!sourceEntry || sourceEntry.type !== "planner_llm_stream") {
    throw new Error(`planner thought not found: ${input.sourceEntryId}`);
  }
  const editedRequestText = input.editedRequestText.trim();
  if (!editedRequestText) throw new Error("editedRequestText is required");
  const previousPrepareEntry = sourceEntry.parentId ? deps.chatEntries.getMessage(input.conversationId, sourceEntry.parentId) : null;
  const prepareParentId =
    previousPrepareEntry && previousPrepareEntry.type === "thought-prepare" ? previousPrepareEntry.parentId : sourceEntry.parentId;
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
    },
  );
  throwIfCancelled(input.shouldCancel);
  await runReasonStep({
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
      llmRequest: editedRequestText,
      enabledToolIds: input.enabledToolIds,
    },
  } as ReasonStepInput<any, any>, { shouldCancel: input.shouldCancel });
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
