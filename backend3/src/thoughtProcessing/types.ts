import type { StreamTextCompletionUsage } from '../llmProviders/provider.js';

export type ThoughtType = 'autoTitle' | 'planner' | 'toolParams';

export type ThoughtStepHandle = {
  step: 'prepare' | 'reason' | 'decision';
};

export type ThoughtExecution = {
  thoughtType: ThoughtType;
  thoughtId: string;
};

export type PrepareStepInput<TSeed = unknown, TThought extends ThoughtExecution = ThoughtExecution> = {
  thought: TThought;
  seed: TSeed;
};

export type ReasonStepInput<TPrepareOutput = unknown, TThought extends ThoughtExecution = ThoughtExecution> = {
  thought: TThought;
  prepareOutput: TPrepareOutput;
};

export type DecisionStepInput<TReasonOutput = unknown, TThought extends ThoughtExecution = ThoughtExecution> = {
  thought: TThought;
  reasonOutput: TReasonOutput;
};

export type ThoughtReasonLlmRequest = {
  prompt: string;
};

export type ThoughtReasonLlmResult = {
  fullResponse: string;
  providerId?: string;
  model?: string;
  usage?: StreamTextCompletionUsage;
};

export type ThoughtLifecycleStartRequest = {
  conversationId: string;
  parentId?: string | null;
  llmRequest: string;
  llmProviderId?: string;
  llmModel?: string;
  kind: 'planner' | 'title';
  includeAction: boolean;
  summary?: string;
};

export type ThoughtLifecycleStarted = {
  thoughtId: string;
  prepareEntryId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
};

export type ThoughtTypeProvider<
  TSeed = unknown,
  TPrepareOutput = unknown,
  TReasonOutput = unknown,
  TThought extends ThoughtExecution = ThoughtExecution,
> = {
  runPrepare: (
    step: ThoughtStepHandle,
    input: PrepareStepInput<TSeed, TThought>,
  ) => Promise<ReasonStepInput<TPrepareOutput, TThought>>;
  runReason: (
    step: ThoughtStepHandle,
    input: ReasonStepInput<TPrepareOutput, TThought>,
  ) => Promise<DecisionStepInput<TReasonOutput, TThought>>;
  runDecision: (step: ThoughtStepHandle, input: DecisionStepInput<TReasonOutput, TThought>) => Promise<void>;
  getReasonLlmRequest?: (input: DecisionStepInput<TReasonOutput, TThought>) => ThoughtReasonLlmRequest | null;
  onReasonLlmDelta?: (input: DecisionStepInput<TReasonOutput, TThought>, delta: string) => void;
  applyReasonLlmResult?: (
    input: DecisionStepInput<TReasonOutput, TThought>,
    result: ThoughtReasonLlmResult,
  ) => DecisionStepInput<TReasonOutput, TThought>;
  getLifecycleStartRequest?: (input: PrepareStepInput<TSeed, TThought>) => ThoughtLifecycleStartRequest | null;
  applyLifecycleStart?: (
    input: PrepareStepInput<TSeed, TThought>,
    started: ThoughtLifecycleStarted,
  ) => PrepareStepInput<TSeed, TThought>;
};
