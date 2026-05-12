import { Injectable } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import type { PreparedReason, ThoughtContext, ThoughtTypeProvider } from '../types.js';

@Injectable()
export class PrepareStep {
  constructor(
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  async run<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    ctx: ThoughtContext,
    scope: LifecycleScope,
  ): Promise<PreparedReason> {
    scope.throwIfAborted();
    const created = await this.chatEntries.appendThoughtPrepareEntry(ctx.conversationId, {
      thoughtId: ctx.thoughtId,
      status: 'running',
      title: provider.prepareTitle,
      llmProviderId: ctx.llmProviderId,
      llmModel: ctx.llmModel,
    });
    ctx.prepareEntryId = created.id;
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);

    let prepared: PreparedReason;
    try {
      scope.throwIfAborted();
      prepared = provider.runPrepare(input);
      await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, {
        status: 'completed',
        requestText: prepared.prompt,
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    } catch (error) {
      await this.markFailed(ctx, created.id, error, scope);
      throw error;
    }
    return prepared;
  }

  private async markFailed(
    ctx: ThoughtContext,
    prepareEntryId: string,
    error: unknown,
    scope: LifecycleScope,
  ): Promise<void> {
    const cancelled = scope.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const detail = error instanceof Error ? error.message : String(error);
    const patch: Record<string, unknown> = { status: cancelled ? 'cancelled' : 'failed' };
    if (!cancelled) patch.error = detail;
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, prepareEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, prepareEntryId);
  }
}
