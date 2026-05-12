import type {
  ChatEntry,
  PlannerLlmStreamEntry,
  TitleLlmStreamEntry,
  ToolParamsLlmStreamEntry,
} from '../contracts/chatEntry.js';
import type { LifecycleScope } from '../conversations/lifecycle-scope.js';
import type { StreamTextCompletionUsage } from '../llmProviders/provider.js';

export type ThoughtStreamEntry = PlannerLlmStreamEntry | TitleLlmStreamEntry | ToolParamsLlmStreamEntry;
export type ThoughtStreamEntryType = ThoughtStreamEntry['type'];

const THOUGHT_STREAM_ENTRY_TYPES: ReadonlySet<ThoughtStreamEntryType> = new Set<ThoughtStreamEntryType>([
  'planner_llm_stream',
  'title_llm_stream',
  'tool_params_llm_stream',
]);

export function isThoughtStreamEntry(entry: ChatEntry): entry is ThoughtStreamEntry {
  return THOUGHT_STREAM_ENTRY_TYPES.has(entry.type as ThoughtStreamEntryType);
}

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

export type ThoughtTypeProvider<TInput> = {
  streamEntryType: ThoughtStreamEntryType;
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
