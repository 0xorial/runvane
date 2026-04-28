import { startThoughtLifecycle } from "../thoughtLifecycle.js";
import { configureThoughtTypeProviders, resolveThoughtTypeProvider } from "./thoughtTypeProviders/index.js";
import { runDecisionStep } from "./steps/decisionStep.js";
import { runPrepareStep } from "./steps/prepareStep.js";
import { runReasonStep } from "./steps/reasonStep.js";
import { configureThoughtRuntime, getThoughtRuntimeDeps } from "./steps/runtimeDeps.js";
import type { PrepareStepInput, ThoughtExecution, ThoughtType } from "./types.js";
import { throwIfCancelled } from "../taskCancellation.js";
import type { AutoTitlePrepareSeed, AutoTitleThought } from "./thoughtTypeProviders/autoTitleProvider.js";
import type { PlannerPrepareSeed, PlannerThought } from "./thoughtTypeProviders/plannerProvider.js";
import type { UserMessageEntry } from "../../types/chatEntry.js";

export type { DecisionStepInput, PrepareStepInput, ReasonStepInput, ThoughtExecution, ThoughtType, ThoughtTypeProvider } from "./types.js";
export type { ThoughtProcessingProviderDeps } from "./thoughtTypeProviders/index.js";
export type { ThoughtRuntimeDeps } from "./steps/runtimeDeps.js";
export { configureThoughtTypeProviders };

export type InitiateThoughtInput<TSeed = unknown, TThought extends ThoughtExecution = ThoughtExecution> = {
  thoughtType: TThought["thoughtType"];
  thought: Omit<TThought, "thoughtType"> & Partial<Pick<TThought, "thoughtType">>;
  seed: TSeed;
};

export type InitiateThoughtResult = {
  thoughtId?: string;
  prepareEntryId?: string;
  streamEntryId?: string;
  thoughtActionEntryId?: string | null;
};

export async function initiateThought(input: {
  conversationId: string;
  thoughtType: ThoughtType;
}, opts?: {
  signal?: AbortSignal;
  onStarted?: (info: {
    thoughtId: string;
    prepareEntryId: string;
    streamEntryId: string;
    thoughtActionEntryId: string | null;
  }) => void;
}): Promise<InitiateThoughtResult> {
  const deps = getThoughtRuntimeDeps();
  const entries = deps.chatEntries.listMessages(input.conversationId);
  if (input.thoughtType === "autoTitle") {
    const firstUserMessage = entries.find((entry): entry is UserMessageEntry => entry.type === "user-message") ?? null;
    if (!firstUserMessage) {
      throw new Error(`autoTitle requires user message context: ${input.conversationId}`);
    }
    return initiateThoughtWithSeed<AutoTitlePrepareSeed, AutoTitleThought>({
      thoughtType: input.thoughtType,
      thought: {
        thoughtId: crypto.randomUUID(),
        conversationId: input.conversationId,
        streamEntryId: "",
      },
      seed: {
        firstMessage: firstUserMessage.text,
      },
    }, opts);
  }
  if (input.thoughtType === "planner") {
    const anchorUserMessage = [...entries].reverse().find((entry): entry is UserMessageEntry => entry.type === "user-message") ?? null;
    if (!anchorUserMessage) {
      throw new Error(`planner requires user message context: ${input.conversationId}`);
    }
    const enabledToolIds = deps.tools
      .list()
      .filter((tool) => {
        const cfg = deps.agents.get(anchorUserMessage.agentId)?.default_llm_configuration?.tools?.[tool.getName()];
        return cfg?.enabled !== false;
      })
      .map((tool) => tool.getName());
    const anchorEntryId = entries.at(-1)?.id ?? anchorUserMessage.id;
    return initiateThoughtWithSeed<PlannerPrepareSeed, PlannerThought>({
      thoughtType: input.thoughtType,
      thought: {
        thoughtId: crypto.randomUUID(),
        conversationId: input.conversationId,
        streamEntryId: "",
      },
      seed: {
        conversationId: input.conversationId,
        anchorEntryId,
        agentId: anchorUserMessage.agentId,
        userText: anchorUserMessage.text,
        systemPrompt: deps.agents.get(anchorUserMessage.agentId)?.system_prompt ?? "",
        enabledToolIds,
      },
    }, opts);
  }
  throw new Error("toolParams requires explicit seed; use initiateThoughtWithSeed");
}

export async function initiateThoughtWithSeed<TSeed = unknown, TThought extends ThoughtExecution = ThoughtExecution>({
  thoughtType,
  thought,
  seed,
}: InitiateThoughtInput<TSeed, TThought>, opts?: {
  signal?: AbortSignal;
  onStarted?: (result: Required<InitiateThoughtResult>) => void;
}): Promise<InitiateThoughtResult> {
  throwIfCancelled(opts?.signal);
  if (thought.thoughtType != null && thought.thoughtType !== thoughtType) {
    throw new Error(`thought type mismatch: expected ${thoughtType}, got ${thought.thoughtType}`);
  }
  let preparedInput = {
    thought: {
      ...thought,
      thoughtType,
    } as TThought,
    seed,
  } satisfies PrepareStepInput<TSeed, TThought>;
  const provider = resolveThoughtTypeProvider(thoughtType);
  const lifecycleRequest = provider.getLifecycleStartRequest?.(preparedInput);
  if (lifecycleRequest) {
    throwIfCancelled(opts?.signal);
    const deps = getThoughtRuntimeDeps();
    const lifecycleInput = {
      ...lifecycleRequest,
      ...(lifecycleRequest.llmProviderId
        ? {}
        : { llmProviderId: deps.llmProviderSettings.getDocument().llm_configuration.provider_id }),
      ...(lifecycleRequest.llmModel ? {} : { llmModel: deps.llmProviderSettings.getDocument().llm_configuration.model_name }),
    };
    const started = lifecycleRequest.includeAction
      ? startThoughtLifecycle(
          { chatEntries: deps.chatEntries, hub: deps.hub },
          { ...lifecycleInput, includeAction: true },
        )
      : startThoughtLifecycle(
          { chatEntries: deps.chatEntries, hub: deps.hub },
          { ...lifecycleInput, includeAction: false },
        );
    const startedResult = {
      thoughtId: started.streamEntry.thoughtId,
      prepareEntryId: started.prepareEntry.id,
      streamEntryId: started.streamEntry.id,
      thoughtActionEntryId: started.thoughtActionEntry?.id ?? null,
    } as const;
    opts?.onStarted?.(startedResult);
    preparedInput = provider.applyLifecycleStart
      ? provider.applyLifecycleStart(preparedInput, {
          ...startedResult,
        })
      : preparedInput;
    throwIfCancelled(opts?.signal);
    await runPrepareStep(preparedInput, { signal: opts?.signal });
    return startedResult;
  }
  throwIfCancelled(opts?.signal);
  await runPrepareStep(preparedInput, { signal: opts?.signal });
  return {};
}

export { configureThoughtRuntime, runDecisionStep, runPrepareStep, runReasonStep };
