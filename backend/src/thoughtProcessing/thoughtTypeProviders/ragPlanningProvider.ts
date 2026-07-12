import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import type { RetrievalQuery } from '../../contracts/retrieval.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

/** Keep in sync with the stub matcher (stubIsRagPlanningRequest). */
export const RAG_PLANNING_SYSTEM_PROMPT =
  'You compose retrieval queries for semantic search over document storages. ' +
  'Given the user message and the available storages, produce 1-4 short search queries that together ' +
  'cover what the message needs. Prefer specific noun phrases over full sentences; split multi-part ' +
  'questions into separate queries. Respond with JSON only: {"queries":["...", ...]}';

const RagPlanReplySchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(4),
});

export type RagPlanningProviderInput = {
  conversationId: string;
  /** The pending retrieval entry this plan feeds (also the thought's anchor). */
  retrievalEntryId: string;
  messageText: string;
  storageNames: string[];
  /**
   * Continuation owned by the conversation processor: executes the retrieval
   * and starts the planner. `null` = "no usable plan" (unparseable reply or a
   * crashed thought) — the processor falls back to the verbatim query, because
   * planning shapes HOW we search, never WHETHER. Once-guarded by the caller;
   * lost on reprocess-from-snapshot (functions don't survive serialization),
   * in which case the decision logs and delivers nowhere.
   */
  onPlanned?: (queries: RetrievalQuery[] | null) => void;
};

/**
 * Phase 2b of the forced-retrieval pipeline (docs/rag-revamp-plan.md D5): a
 * side thought anchored to the pending retrieval entry that turns the verbatim
 * user message into targeted storage queries. Its structured output IS the
 * shared RetrievalQuery shape — the executor and the entry rendering never
 * know whether a human or this thought composed the queries.
 */
@Injectable()
export class RagPlanningThoughtTypeProvider implements ThoughtTypeProvider<RagPlanningProviderInput> {
  readonly thoughtType = 'rag_planning' as const;
  readonly prepareTitle = 'Plan retrieval queries';

  private readonly logger = new Logger(RagPlanningThoughtTypeProvider.name);

  constructor(
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  runPrepare = (input: RagPlanningProviderInput): LlmRequest => {
    const userContent =
      `Available storages: ${input.storageNames.join(', ') || '(none)'}\n\n` +
      `User message:\n${input.messageText}\n\n` +
      'Respond with JSON only: {"queries":["...", ...]} (1-4 queries).';
    return {
      messages: [textMessage('system', RAG_PLANNING_SYSTEM_PROMPT), textMessage('user', userContent)],
    };
  };

  onLlmEvent = (_input: RagPlanningProviderInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.streamEntryId) return;
    publishStreamFieldDelta(this.hub, ctx.conversationId, ctx.streamEntryId, event);
  };

  runDecision = async (
    input: RagPlanningProviderInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
  ): Promise<void> => {
    const raw = getCompletionText(completion).trim();
    const jsonText = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let queries: RetrievalQuery[] | null = null;
    try {
      const parsed = RagPlanReplySchema.safeParse(JSON.parse(jsonText));
      if (parsed.success) {
        queries = parsed.data.queries.map((text) => ({ text, origin: 'planned' as const }));
      } else {
        this.logger.warn(`rag planning: reply shape invalid (${parsed.error.message}) — verbatim fallback`);
      }
    } catch {
      this.logger.warn(`rag planning: JSON parse failed for "${raw.slice(0, 200)}" — verbatim fallback`);
    }

    if (ctx.thoughtActionEntryId) {
      await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
        summary: queries
          ? `Planned ${queries.length} ${queries.length === 1 ? 'query' : 'queries'}`
          : 'Unparseable plan — verbatim fallback',
        action: 'rag_plan',
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
    }

    if (!input.onPlanned) {
      // Reprocessed from snapshot: the original turn's continuation is gone
      // and the retrieval entry it fed has long been resolved.
      this.logger.warn('rag planning: no continuation attached — plan not delivered');
      return;
    }
    input.onPlanned(queries);
  };

  /**
   * Fires for every run, including crashes before the decision. Delivering
   * `null` here makes a failed planning call degrade to verbatim retrieval
   * instead of stranding the turn; after a successful decision the caller's
   * once-guard turns this into a no-op.
   */
  onThoughtSettled = (input: RagPlanningProviderInput): void => {
    input.onPlanned?.(null);
  };
}
