import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import type { ChatAttachment } from '../../contracts/chatEntry.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmMessage, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import type { BatchBarrier } from '../lib/batchBarrier.js';
import { ThoughtProcessingService } from '../thought-processing.service.js';
import type { LlmRef, ThoughtContext, ThoughtTypeProvider } from '../types.js';
import { PlannerThoughtTypeProvider } from './plannerProvider.js';

export type SummarizeAttachmentInput = {
  conversationId: string;
  attachment: ChatAttachment;
  /** Id of the user-message that triggered this batch of summaries. */
  userMessageId: string;
  /**
   * Spine entry the planner anchors at once every summary settles — the
   * run's tip when the batch was dispatched (the user message, or the
   * context-injection entry when one was appended after it). The summaries
   * themselves are side thoughts and never move the spine.
   */
  plannerAnchorId: string;
  /**
   * Per-batch barrier shared by every summarize task in this user-message.
   * Signaled idempotently from both the success path (end of
   * `runDecision`) and the universal `onThoughtSettled` finally — so the
   * barrier resolves once every peer has either persisted its summary or
   * failed mid-pipeline.
   */
  peersDone: BatchBarrier;
  /** LLM the planner should run on after all summaries land. */
  plannerLlm: LlmRef;
};

const UNAVAILABLE_PLACEHOLDER = '[summary unavailable]';

/**
 * Produces a compact, queryable summary of a single attachment.
 *
 * Runs once per `summary`-mode upload right after the user message lands and
 * before the planner. The planner prompt then renders the summary text in
 * place of the raw bytes; the agent can call `ask_attachment` to query the
 * full content when the summary isn't enough.
 *
 * The `attachment_ref` content part is expanded to the real image/file part
 * by `ReasonStep` → `expandAttachmentRefs` (same path used by the planner),
 * so this provider works for every mime type the provider adapter supports.
 */
@Injectable()
export class SummarizeAttachmentThoughtTypeProvider implements ThoughtTypeProvider<SummarizeAttachmentInput> {
  readonly thoughtType = 'summarize_attachment' as const;
  readonly prepareTitle = 'Summarize attachment';
  private readonly logger = new Logger(SummarizeAttachmentThoughtTypeProvider.name);
  /**
   * Per-scope idempotency guard — only the first task in a batch to
   * observe "all peer summaries settled" actually starts the planner.
   * `WeakSet` so the entry is GC'd with the scope when the run finishes.
   */
  private readonly plannerStartedForScope = new WeakSet<LifecycleScope>();

  constructor(
    private readonly chatEntries: ChatEntriesRepo,
    private readonly hub: SseHubService,
    @Inject(forwardRef(() => ThoughtProcessingService))
    private readonly thoughtProcessing: ThoughtProcessingService,
    @Inject(forwardRef(() => PlannerThoughtTypeProvider))
    private readonly plannerProvider: PlannerThoughtTypeProvider,
  ) {}

  thoughtEntryExtraPayload = (input: SummarizeAttachmentInput): Record<string, unknown> => ({
    attachmentId: input.attachment.id,
    userMessageId: input.userMessageId,
    filename: input.attachment.name,
    mimeType: input.attachment.mimeType,
    sizeBytes: input.attachment.sizeBytes,
  });

  runPrepare = (input: SummarizeAttachmentInput): LlmRequest => ({
    messages: buildSummarizeAttachmentMessages(input.attachment),
  });

  onLlmEvent = (_input: SummarizeAttachmentInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.thoughtEntryId) return;
    publishStreamFieldDelta(this.hub, ctx.conversationId, ctx.thoughtEntryId, event);
  };

  /**
   * Persist `summaryText` onto our own stream entry, then wait for every
   * peer in this batch to settle before (maybe) starting the planner.
   * The barrier handles both success and failure paths — see
   * `onThoughtSettled` for the failure-side signal.
   */
  runDecision = async (
    input: SummarizeAttachmentInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
    scope: LifecycleScope,
  ): Promise<void> => {
    if (!ctx.thoughtEntryId) throw new Error('summarize-attachment runDecision requires ctx.thoughtEntryId');
    const rawText = getCompletionText(completion).trim();
    const summaryText = rawText.length > 0 ? rawText : UNAVAILABLE_PLACEHOLDER;
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, ctx.thoughtEntryId, { summaryText });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtEntryId);
    if (ctx.thoughtEntryId) {
      // Custom summary only — status is flipped by DecisionStep.
      await this.chatEntries.updateThoughtDecision(ctx.conversationId, ctx.thoughtEntryId, {
        summary: `Summarized ${input.attachment.name}`,
        action: 'final_answer',
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtEntryId);
    }
    input.peersDone.signal(input.attachment.id);
    await input.peersDone.wait();
    this.maybeStartPlanner(input, ctx, scope);
  };

  /**
   * Failure-path signal — fires from the spawn-task `finally` even when
   * prepare/reason threw before `runDecision` could run. Idempotent with
   * the success-path signal in `runDecision`.
   */
  onThoughtSettled = (input: SummarizeAttachmentInput): void => {
    input.peersDone.signal(input.attachment.id);
  };

  /**
   * Called after the barrier resolves — every peer has signaled, so the
   * batch is fully settled. Concurrent tasks all pass the barrier; the
   * `WeakSet` test-and-set picks exactly one winner to start the planner.
   */
  private maybeStartPlanner(input: SummarizeAttachmentInput, ctx: ThoughtContext, scope: LifecycleScope): void {
    if (this.plannerStartedForScope.has(scope)) return;
    this.plannerStartedForScope.add(scope);
    if (scope.signal.aborted) return;
    this.logger.log('attachment summaries settled — starting planner');
    this.thoughtProcessing.startThought({
      provider: this.plannerProvider,
      conversationId: ctx.conversationId,
      scope,
      anchorParentId: input.plannerAnchorId,
      lane: 'spine',
      llm: input.plannerLlm,
    });
  }
}

function buildSummarizeAttachmentMessages(attachment: ChatAttachment): LlmMessage[] {
  return [
    textMessage(
      'system',
      'You summarize a single attachment. Output one self-contained, faithful summary suitable ' +
        'for a downstream agent that cannot see the raw file. Capture: purpose, structure/sections, ' +
        'key facts, identifiers (names, numbers, dates, code symbols, URLs), and anything an agent ' +
        'would need to answer questions or decide on follow-up tool calls. Do not editorialize. ' +
        'Do not address the user. Output the summary text only.',
    ),
    {
      role: 'user',
      parts: [
        {
          kind: 'text',
          text:
            `Attachment: ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes).\n` +
            `Summarize the attached content.`,
        },
        {
          kind: 'attachment_ref',
          attachmentId: attachment.id,
          mime: attachment.mimeType,
          filename: attachment.name,
          sizeBytes: attachment.sizeBytes,
        },
      ],
    },
  ];
}
