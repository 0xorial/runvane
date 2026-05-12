import type { LifecycleScope } from '../conversations/lifecycle-scope.js';
import type { StreamTextCompletionUsage } from '../llmProviders/provider.js';

export type ThoughtType = 'autoTitle' | 'planner' | 'toolParams';
export type ThoughtStepName = 'prepare' | 'reason' | 'decision';

export type ThoughtContext = {
  thoughtId: string;
  conversationId: string;
  llmProviderId: string;
  llmModel: string;
  prepareEntryId: string | null;
  streamEntryId: string | null;
  thoughtActionEntryId: string | null;
};

export type ThoughtReasonLlmResult = {
  fullResponse: string;
  providerId?: string;
  model?: string;
  usage?: StreamTextCompletionUsage;
};

export type PreparedReason = {
  prompt: string;
};

export type ThoughtTypeProvider<TInput, TThoughtType extends ThoughtType = ThoughtType> = {
  thoughtType: TThoughtType;
  streamKind: 'planner' | 'title';
  wantsAction: boolean;
  prepareTitle: string;
  initialActionSummary?: string;
  buildInputFromConversation?: (conversationId: string) => Promise<TInput>;
  runPrepare: (input: TInput) => PreparedReason;
  onLlmDelta?: (input: TInput, ctx: ThoughtContext, delta: string) => void;
  runDecision: (
    input: TInput,
    ctx: ThoughtContext,
    llmResult: ThoughtReasonLlmResult,
    scope: LifecycleScope,
  ) => Promise<void>;
};
