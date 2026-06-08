import { Injectable } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishConversationUpdated } from '../../sse/sse-helpers.js';
import { providerCostEntryFieldsFromUsage } from '../../contracts/provider-cost.js';
import type { LlmCompletion } from '../../llmProviders/types.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

@Injectable()
export class DecisionStep {
  constructor(
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly conversations: ConversationsRepo,
  ) {}

  /** Persist token/cost usage without running provider decision logic (e.g. aborted streams). */
  async recordUsage(ctx: ThoughtContext, completion: LlmCompletion): Promise<void> {
    await this.persistUsage(ctx, completion);
  }

  async run<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    ctx: ThoughtContext,
    completion: LlmCompletion,
    scope: LifecycleScope,
  ): Promise<void> {
    scope.throwIfAborted();
    await this.persistUsage(ctx, completion);
    try {
      await provider.runDecision(input, ctx, completion, scope);
    } catch (error) {
      await this.markFailed(ctx, error, scope);
      throw error;
    }
    await this.markCompleted(ctx);
  }

  /**
   * Fallback action-entry status flip — runs after every successful
   * `provider.runDecision`. Providers can still set their own
   * `summary`/`action`/`status` inside `runDecision` (e.g. `autoTitle`
   * sets `action: 'final_answer'`); this just guarantees the chip stops
   * showing "running" when the decision is actually done.
   */
  private async markCompleted(ctx: ThoughtContext): Promise<void> {
    if (!ctx.thoughtActionEntryId) return;
    await this.chatEntries.updateThoughtAction(ctx.conversationId, ctx.thoughtActionEntryId, {
      status: 'completed',
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.thoughtActionEntryId);
  }

  private async persistUsage(ctx: ThoughtContext, completion: LlmCompletion): Promise<void> {
    if (!completion.usage || !ctx.streamEntryId) return;
    const { promptTokens, completionTokens, cachedPromptTokens } = completion.usage;
    const patch: Record<string, unknown> = {
      promptTokens,
      completionTokens,
      ...providerCostEntryFieldsFromUsage(completion.usage),
    };
    if (typeof cachedPromptTokens === 'number') patch.cachedPromptTokens = cachedPromptTokens;
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, ctx.streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.streamEntryId);
    await this.conversations.addTokenUsage(ctx.conversationId, {
      promptTokens,
      cachedPromptTokens: cachedPromptTokens ?? 0,
      completionTokens,
    });
    await publishConversationUpdated(this.hub, this.conversations, this.chatEntries, ctx.conversationId);
  }

  private async markFailed(ctx: ThoughtContext, error: unknown, scope: LifecycleScope): Promise<void> {
    const actionEntryId = ctx.thoughtActionEntryId;
    if (!actionEntryId) return;
    const cancelled = scope.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    if (cancelled) return;
    const detail = error instanceof Error ? error.message : String(error);
    await this.chatEntries.updateThoughtAction(ctx.conversationId, actionEntryId, {
      status: 'failed',
      action: 'failed',
      summary: detail,
      error: detail,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, actionEntryId);
  }
}
