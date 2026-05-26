import type {
  ChatEntry,
  GuardrailLlmStreamEntry,
  PlannerLlmStreamEntry,
  SummarizeAttachmentLlmStreamEntry,
  SummarizeLlmStreamEntry,
  TitleLlmStreamEntry,
  ToolParamsLlmStreamEntry,
} from '../contracts/chatEntry.js';
import type { LlmRef } from '../contracts/llm.js';
import type { ChatChain } from '../conversations/chat-chain.js';
import type { LifecycleScope } from '../conversations/lifecycle-scope.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../llmProviders/types.js';

export type { LlmRef };

export type ThoughtStreamEntry =
  | PlannerLlmStreamEntry
  | TitleLlmStreamEntry
  | ToolParamsLlmStreamEntry
  | SummarizeLlmStreamEntry
  | SummarizeAttachmentLlmStreamEntry
  | GuardrailLlmStreamEntry;
export type ThoughtStreamEntryType = ThoughtStreamEntry['type'];

const THOUGHT_STREAM_ENTRY_TYPES: ReadonlySet<ThoughtStreamEntryType> = new Set<ThoughtStreamEntryType>([
  'planner_llm_stream',
  'title_llm_stream',
  'tool_params_llm_stream',
  'summarize_llm_stream',
  'summarize_attachment_llm_stream',
  'guardrail_llm_stream',
]);

export function isThoughtStreamEntry(entry: ChatEntry): entry is ThoughtStreamEntry {
  return THOUGHT_STREAM_ENTRY_TYPES.has(entry.type as ThoughtStreamEntryType);
}

export type ThoughtContext = {
  thoughtId: string;
  conversationId: string;
  llm: LlmRef;
  prepareEntryId: string | null;
  streamEntryId: string | null;
  thoughtActionEntryId: string | null;
  /** Per-run chat-entry append cursor shared across thoughts in the same scope. */
  chain: ChatChain;
};

export type ThoughtTypeProvider<TInput> = {
  streamEntryType: ThoughtStreamEntryType;
  prepareTitle: string;
  initialActionSummary?: string;
  /**
   * `leafEntryId` is the run's chain tip — the deepest entry on the branch
   * this thought is writing to. Implementations MUST walk lineage from this
   * leaf rather than re-resolving the conversation's default-view leaf, so
   * concurrent sibling branches and UI branch-switches can't poison the
   * run's input.
   */
  buildInputFromConversation?: (conversationId: string, leafEntryId: string) => Promise<TInput>;
  /**
   * Returns the LLM request (messages, optional tools, response format).
   * Model is resolved at the LLM-config layer and passed to the provider
   * adapter separately, so it is intentionally absent from this shape.
   * The display/edit surface on the prepare entry is the JSON.stringify
   * of this request — what you see is exactly what hits the wire.
   */
  runPrepare: (input: TInput) => LlmRequest;
  /**
   * Optional payload merged onto the stream entry at creation time. Lets
   * provider-specific fields (e.g. `attachmentId` on
   * `summarize_attachment_llm_stream`) land on the stream entry without each
   * provider re-implementing chain append.
   */
  streamEntryExtraPayload?: (input: TInput) => Record<string, unknown>;
  onLlmEvent?: (input: TInput, ctx: ThoughtContext, event: LlmStreamEvent) => void;
  runDecision: (
    input: TInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
    scope: LifecycleScope,
  ) => Promise<void>;
  /**
   * Fires from the spawn-task `finally` for EVERY thought run, regardless
   * of whether prepare/reason/decision succeeded or threw. Use this to
   * release per-batch barriers / latches so peers waiting on completion
   * can't deadlock when a sibling fails mid-pipeline.
   */
  onThoughtSettled?: (input: TInput, ctx: ThoughtContext) => void;
};
