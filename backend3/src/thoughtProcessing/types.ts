import type { StreamTextCompletionUsage } from '../llmProviders/provider.js';

export type ThoughtType = 'autoTitle' | 'planner' | 'toolParams';
export type ThoughtStepName = 'prepare' | 'reason' | 'decision';

export type ThoughtLifecycleEntries = {
  thoughtId: string;
  conversationId: string;
  prepareEntryId: string;
  streamEntryId: string;
  thoughtActionEntryId: string | null;
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

export type PreparedReason = {
  prompt: string;
};

export type ThoughtTypeProvider<TInput, TThoughtType extends ThoughtType = ThoughtType> = {
  thoughtType: TThoughtType;
  buildInputFromConversation?: (conversationId: string) => Promise<TInput>;
  getLifecycleStartRequest: (input: TInput) => ThoughtLifecycleStartRequest;
  runPrepare: (input: TInput) => PreparedReason;
  onLlmDelta?: (input: TInput, lifecycle: ThoughtLifecycleEntries, delta: string) => void;
  runDecision: (
    input: TInput,
    lifecycle: ThoughtLifecycleEntries,
    llmResult: ThoughtReasonLlmResult,
    signal: AbortSignal,
  ) => Promise<void>;
};
