import { startThoughtLifecycle } from "../thoughtLifecycle.js";
import { configureThoughtTypeProviders, resolveThoughtTypeProvider } from "./thoughtTypeProviders/index.js";
import { runDecisionStep } from "./steps/decisionStep.js";
import { runPrepareStep } from "./steps/prepareStep.js";
import { runReasonStep } from "./steps/reasonStep.js";
import { configureThoughtRuntime, getThoughtRuntimeDeps } from "./steps/runtimeDeps.js";
import type { PrepareStepInput, ThoughtExecution } from "./types.js";
import { throwIfCancelled } from "../taskCancellation.js";

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

export async function initiateThought<TSeed = unknown, TThought extends ThoughtExecution = ThoughtExecution>({
  thoughtType,
  thought,
  seed,
}: InitiateThoughtInput<TSeed, TThought>, opts?: {
  shouldCancel?: () => boolean;
  onStarted?: (result: Required<InitiateThoughtResult>) => void;
}): Promise<InitiateThoughtResult> {
  throwIfCancelled(opts?.shouldCancel);
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
    throwIfCancelled(opts?.shouldCancel);
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
    throwIfCancelled(opts?.shouldCancel);
    await runPrepareStep(preparedInput, opts);
    return startedResult;
  }
  throwIfCancelled(opts?.shouldCancel);
  await runPrepareStep(preparedInput, opts);
  return {};
}

export { configureThoughtRuntime, runDecisionStep, runPrepareStep, runReasonStep };
