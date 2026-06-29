import type { ChatEntry, ThoughtStreamEntry, ThoughtType } from '../contracts/chatEntry.js';
import type { LlmRef } from '../contracts/llm.js';
import type { ChatChain } from '../conversations/chat-chain.js';
import type { LifecycleScope } from '../conversations/lifecycle-scope.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../llmProviders/types.js';

export type { LlmRef, ThoughtStreamEntry, ThoughtType };

export function isThoughtStreamEntry(entry: ChatEntry): entry is ThoughtStreamEntry {
  return entry.type === 'thought_stream';
}

export type ThoughtContext = {
  thoughtId: string;
  conversationId: string;
  /** Model for THIS thought's own LLM call. */
  llm: LlmRef;
  /**
   * Model that downstream thoughts (tool-param resolution, the post-tool
   * planner continuation, …) should use. Equals `llm` for every normal flow;
   * differs only for a "try model — just this call" reprocess, where this
   * thought runs on an override model but the continuation reverts to the
   * inherited one.
   */
  downstreamLlm: LlmRef;
  prepareEntryId: string | null;
  streamEntryId: string | null;
  thoughtActionEntryId: string | null;
  /** Per-run chat-entry append cursor shared across thoughts in the same scope. */
  chain: ChatChain;
};

export type ThoughtTypeProvider<TInput> = {
  thoughtType: ThoughtType;
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
   * provider-specific fields (e.g. `attachmentId` on the
   * `summarize_attachment` thought stream) land on the stream entry without
   * each provider re-implementing chain append.
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
