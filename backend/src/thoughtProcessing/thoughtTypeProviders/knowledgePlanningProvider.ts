import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishStreamFieldDelta } from '../../sse/sse-helpers.js';
import { getCompletionText, textMessage } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmRequest, LlmStreamEvent } from '../../llmProviders/types.js';
import type { RetrievalQuery } from '../../contracts/retrieval.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

/** Keep in sync with the stub matcher (stubIsKnowledgePlanningRequest). */
export const KNOWLEDGE_PLANNING_SYSTEM_PROMPT =
  'You compose retrieval queries for semantic search over document storages. ' +
  'Given the user message and the available storages, produce 1-4 short search queries that together ' +
  'cover what the message needs. Prefer specific noun phrases over full sentences; split multi-part ' +
  'questions into separate queries. Respond with JSON only: {"queries":["...", ...]}';

const KnowledgePlanReplySchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(4),
});

export type KnowledgePlanningProviderInput = {
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
 * Phase 2b of the forced-retrieval pipeline (docs/knowledge-revamp-plan.md D5): a
 * side thought anchored to the pending retrieval entry that turns the verbatim
 * user message into targeted storage queries. Its structured output IS the
 * shared RetrievalQuery shape — the executor and the entry rendering never
 * know whether a human or this thought composed the queries.
 */
@Injectable()
export class KnowledgePlanningThoughtTypeProvider implements ThoughtTypeProvider<KnowledgePlanningProviderInput> {
  readonly thoughtType = 'knowledge_planning' as const;
  readonly prepareTitle = 'Plan retrieval queries';

  private readonly logger = new Logger(KnowledgePlanningThoughtTypeProvider.name);

  constructor(
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  runPrepare = (input: KnowledgePlanningProviderInput): LlmRequest => {
    const userContent =
      `Available storages: ${input.storageNames.join(', ') || '(none)'}\n\n` +
      `User message:\n${input.messageText}\n\n` +
      'Respond with JSON only: {"queries":["...", ...]} (1-4 queries).';
    return {
      messages: [textMessage('system', KNOWLEDGE_PLANNING_SYSTEM_PROMPT), textMessage('user', userContent)],
    };
  };

  onLlmEvent = (_input: KnowledgePlanningProviderInput, ctx: ThoughtContext, event: LlmStreamEvent): void => {
    if (!ctx.thoughtEntryId) return;
    publishStreamFieldDelta(this.hub, ctx.conversationId, ctx.thoughtEntryId, event);
  };

  runDecision = async (
    input: KnowledgePlanningProviderInput,
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
      const parsed = KnowledgePlanReplySchema.safeParse(JSON.parse(jsonText));
      if (parsed.success) {
        queries = parsed.data.queries.map((text) => ({ text, origin: 'planned' as const }));
      } else {
        this.logger.warn(`knowledge planning: reply shape invalid (${parsed.error.message}) — verbatim fallback`);
      }
    } catch {
      this.logger.warn(`knowledge planning: JSON parse failed for "${raw.slice(0, 200)}" — verbatim fallback`);
    }

    if (ctx.thoughtEntryId) {
      await this.chatEntries.updateThoughtDecision(ctx.conversationId, ctx.thoughtEntryId, {
        summary: queries
          ? `Planned ${queries.length} ${queries.length === 1 ? 'query' : 'queries'}`
          : 'Unparseable plan — verbatim fallback',
        action: 'knowledge_plan',
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtEntryId);
    }

    if (!input.onPlanned) {
      // Reprocessed from snapshot: the original turn's continuation is gone
      // and the retrieval entry it fed has long been resolved.
      this.logger.warn('knowledge planning: no continuation attached — plan not delivered');
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
  onThoughtSettled = (input: KnowledgePlanningProviderInput): void => {
    input.onPlanned?.(null);
  };
}
