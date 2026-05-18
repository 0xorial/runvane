import { Injectable } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { ConversationsRepo } from '../../db/repositories/conversations.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert, publishConversationUpdated } from '../../sse/sse-helpers.js';
import type { LlmCompletion } from '../../llmProviders/types.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

@Injectable()
export class DecisionStep {
  constructor(
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly conversations: ConversationsRepo,
  ) {}

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
  }

  private async persistUsage(ctx: ThoughtContext, completion: LlmCompletion): Promise<void> {
    if (!completion.usage || !ctx.streamEntryId) return;
    const { promptTokens, completionTokens, cachedPromptTokens } = completion.usage;
    const patch: Record<string, unknown> = { promptTokens, completionTokens };
    if (typeof cachedPromptTokens === 'number') patch.cachedPromptTokens = cachedPromptTokens;
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, ctx.streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, ctx.streamEntryId);
    await this.conversations.addTokenUsage(ctx.conversationId, {
      promptTokens,
      cachedPromptTokens: cachedPromptTokens ?? 0,
      completionTokens,
    });
    await publishConversationUpdated(this.hub, this.conversations, ctx.conversationId);
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
