import { configureThoughtTypeProviders, resolveThoughtTypeProvider } from './thoughtTypeProviders/index.js';
import { runDecisionStep } from './steps/decisionStep.js';
import { runPrepareStep } from './steps/prepareStep.js';
import { runReasonStep } from './steps/reasonStep.js';
import { configureThoughtRuntime, getThoughtRuntimeDeps } from './steps/runtimeDeps.js';
import type { PrepareStepInput, ThoughtExecution, ThoughtType } from './types.js';
import type { AutoTitlePrepareSeed, AutoTitleThought } from './thoughtTypeProviders/autoTitleProvider.js';
import type { PlannerPrepareSeed, PlannerThought } from './thoughtTypeProviders/plannerProvider.js';

export type {
  DecisionStepInput,
  PrepareStepInput,
  ReasonStepInput,
  ThoughtExecution,
  ThoughtType,
  ThoughtTypeProvider,
} from './types.js';
export type { ThoughtProcessingProviderDeps } from './thoughtTypeProviders/index.js';
export type { ThoughtRuntimeDeps } from './steps/runtimeDeps.js';
export { configureThoughtTypeProviders };

export type InitiateThoughtInput<TSeed = unknown, TThought extends ThoughtExecution = ThoughtExecution> = {
  thoughtType: TThought['thoughtType'];
  thought: Omit<TThought, 'thoughtType'> & Partial<Pick<TThought, 'thoughtType'>>;
  seed: TSeed;
};

export type InitiateThoughtResult = {
  thoughtId?: string;
  prepareEntryId?: string;
  streamEntryId?: string;
  thoughtActionEntryId?: string | null;
};

export async function initiateThought(
  input: {
    conversationId: string;
    thoughtType: ThoughtType;
  },
  opts?: {
    signal?: AbortSignal;
    onStarted?: (info: {
      thoughtId: string;
      prepareEntryId: string;
      streamEntryId: string;
      thoughtActionEntryId: string | null;
    }) => void;
  },
): Promise<InitiateThoughtResult> {
  const deps = getThoughtRuntimeDeps();
  const entries = deps.chatEntries.listMessages(input.conversationId);

  if (input.thoughtType === 'autoTitle') {
    const firstUserMessage = entries.find((entry) => entry.type === 'user-message') ?? null;
    if (!firstUserMessage || !firstUserMessage.text) {
      throw new Error(`autoTitle requires user message context: ${input.conversationId}`);
    }
    return initiateThoughtWithSeed<AutoTitlePrepareSeed, AutoTitleThought>(
      {
        thoughtType: input.thoughtType,
        thought: {
          thoughtId: crypto.randomUUID(),
          conversationId: input.conversationId,
          streamEntryId: '',
        },
        seed: {
          firstMessage: firstUserMessage.text,
        },
      },
      opts,
    );
  }

  if (input.thoughtType === 'planner') {
    const anchorUserMessage = [...entries].reverse().find((entry) => entry.type === 'user-message') ?? null;
    if (!anchorUserMessage || !anchorUserMessage.text) {
      throw new Error(`planner requires user message context: ${input.conversationId}`);
    }
    const enabledToolIds = deps.tools
      .list()
      .filter((tool) => (tool.isEnabledForAgent ? tool.isEnabledForAgent(anchorUserMessage.agentId ?? null) : true))
      .map((tool) => tool.getName());
    const anchorEntryId = entries.at(-1)?.id ?? anchorUserMessage.id;
    const agent = deps.agents.get(anchorUserMessage.agentId ?? null);
    return initiateThoughtWithSeed<PlannerPrepareSeed, PlannerThought>(
      {
        thoughtType: input.thoughtType,
        thought: {
          thoughtId: crypto.randomUUID(),
          conversationId: input.conversationId,
          streamEntryId: '',
        },
        seed: {
          conversationId: input.conversationId,
          anchorEntryId,
          agentId: anchorUserMessage.agentId ?? null,
          userText: anchorUserMessage.text,
          systemPrompt: agent?.systemPrompt ?? '',
          enabledToolIds,
        },
      },
      opts,
    );
  }

  throw new Error('toolParams requires explicit seed; use initiateThoughtWithSeed');
}

export async function initiateThoughtWithSeed<TSeed = unknown, TThought extends ThoughtExecution = ThoughtExecution>(
  { thoughtType, thought, seed }: InitiateThoughtInput<TSeed, TThought>,
  opts?: {
    signal?: AbortSignal;
    onStarted?: (result: Required<InitiateThoughtResult>) => void;
  },
): Promise<InitiateThoughtResult> {
  opts?.signal?.throwIfAborted();
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
    opts?.signal?.throwIfAborted();
    const deps = getThoughtRuntimeDeps();
    const llmDoc = await deps.llmProviderSettings.getDocument();
    const startedResult = {
      thoughtId: crypto.randomUUID(),
      prepareEntryId: crypto.randomUUID(),
      streamEntryId: crypto.randomUUID(),
      thoughtActionEntryId: lifecycleRequest.includeAction ? crypto.randomUUID() : null,
    } as const;
    opts?.onStarted?.(startedResult);
    deps.hub.publish(lifecycleRequest.conversationId, {
      type: 'thought.started',
      ...startedResult,
      llmProviderId: lifecycleRequest.llmProviderId ?? llmDoc.llm_configuration.provider_id,
      llmModel: lifecycleRequest.llmModel ?? llmDoc.llm_configuration.model_name,
      summary: lifecycleRequest.summary ?? null,
    });
    preparedInput = provider.applyLifecycleStart
      ? provider.applyLifecycleStart(preparedInput, {
          ...startedResult,
        })
      : preparedInput;
    opts?.signal?.throwIfAborted();
    await runPrepareStep(preparedInput, { signal: opts?.signal });
    return startedResult;
  }
  opts?.signal?.throwIfAborted();
  await runPrepareStep(preparedInput, { signal: opts?.signal });
  return {};
}

export { configureThoughtRuntime, runDecisionStep, runPrepareStep, runReasonStep };
