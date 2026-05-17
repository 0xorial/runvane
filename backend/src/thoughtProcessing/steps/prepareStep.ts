import { Injectable } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { requestToDisplay } from '../../llmProviders/messages.js';
import type { LlmRequest } from '../../llmProviders/types.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';

export type PreparedReason = {
  request: LlmRequest;
  display: string;
};

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
    const prepareEntryId = ctx.prepareEntryId;
    if (!prepareEntryId) throw new Error('PrepareStep.run requires ctx.prepareEntryId to be pre-allocated');
    let prepared: PreparedReason;
    try {
      scope.throwIfAborted();
      const request = provider.runPrepare(input);
      prepared = { request, display: requestToDisplay(request) };
      await this.chatEntries.mergeEntryPayload(ctx.conversationId, prepareEntryId, {
        status: 'completed',
        requestText: prepared.display,
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, prepareEntryId);
    } catch (error) {
      await this.markFailed(ctx, prepareEntryId, error, scope);
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
