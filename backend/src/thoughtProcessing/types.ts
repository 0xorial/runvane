import type {
  ChatEntry,
  PlannerLlmStreamEntry,
  SummarizeLlmStreamEntry,
  TitleLlmStreamEntry,
  ToolParamsLlmStreamEntry,
} from '../contracts/chatEntry.js';
import type { ChatChain } from '../conversations/chat-chain.js';
import type { LifecycleScope } from '../conversations/lifecycle-scope.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../llmProviders/types.js';

export type ThoughtStreamEntry =
  | PlannerLlmStreamEntry
  | TitleLlmStreamEntry
  | ToolParamsLlmStreamEntry
  | SummarizeLlmStreamEntry;
export type ThoughtStreamEntryType = ThoughtStreamEntry['type'];

const THOUGHT_STREAM_ENTRY_TYPES: ReadonlySet<ThoughtStreamEntryType> = new Set<ThoughtStreamEntryType>([
  'planner_llm_stream',
  'title_llm_stream',
  'tool_params_llm_stream',
  'summarize_llm_stream',
]);

export function isThoughtStreamEntry(entry: ChatEntry): entry is ThoughtStreamEntry {
  return THOUGHT_STREAM_ENTRY_TYPES.has(entry.type as ThoughtStreamEntryType);
}

export type LlmRef = {
  providerId: string;
  model: string;
};

export type ThoughtContext = {
  thoughtId: string;
  conversationId: string;
  llmProviderId: string;
  llmModel: string;
  prepareEntryId: string | null;
  streamEntryId: string | null;
  thoughtActionEntryId: string | null;
  /** Per-run chat-entry append cursor shared across thoughts in the same scope. */
  chain: ChatChain;
};

export type ThoughtTypeProvider<TInput> = {
  streamEntryType: ThoughtStreamEntryType;
  wantsAction: boolean;
  prepareTitle: string;
  initialActionSummary?: string;
  buildInputFromConversation?: (conversationId: string) => Promise<TInput>;
  /**
   * Returns the LLM request (messages, optional tools, response format).
   * Model is resolved at the LLM-config layer and passed to the provider
   * adapter separately, so it is intentionally absent from this shape.
   * The display/edit surface on the prepare entry is the JSON.stringify
   * of this request — what you see is exactly what hits the wire.
   */
  runPrepare: (input: TInput) => LlmRequest;
  onLlmEvent?: (input: TInput, ctx: ThoughtContext, event: LlmStreamEvent) => void;
  runDecision: (
    input: TInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
    scope: LifecycleScope,
  ) => Promise<void>;
};
