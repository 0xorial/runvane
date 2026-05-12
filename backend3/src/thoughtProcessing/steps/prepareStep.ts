import { Injectable } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
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
    signal: AbortSignal,
  ): Promise<PreparedReason> {
    signal.throwIfAborted();
    const created = await this.chatEntries.appendThoughtPrepareEntry(ctx.conversationId, {
      thoughtId: ctx.thoughtId,
      status: 'running',
      title: provider.prepareTitle,
      llmProviderId: ctx.llmProviderId,
      llmModel: ctx.llmModel,
    });
    ctx.prepareEntryId = created.id;
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    this.hub.publish(ctx.conversationId, {
      type: SseType.THOUGHT_PREPARE_STEP_STARTING,
      chatEntryId: created.id,
      thoughtId: ctx.thoughtId,
    });

    let prepared: PreparedReason;
    try {
      signal.throwIfAborted();
      prepared = provider.runPrepare(input);
      await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, {
        status: 'completed',
        requestText: prepared.prompt,
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
      this.hub.publish(ctx.conversationId, {
        type: SseType.THOUGHT_PREPARE_STEP_FINISHED,
        chatEntryId: created.id,
      });
    } catch (error) {
      await this.markFailed(ctx, created.id, error, signal);
      throw error;
    }
    return prepared;
  }

  private async markFailed(
    ctx: ThoughtContext,
    prepareEntryId: string,
    error: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const detail = error instanceof Error ? error.message : String(error);
    const patch: Record<string, unknown> = { status: cancelled ? 'cancelled' : 'failed' };
    if (!cancelled) patch.error = detail;
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, prepareEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, prepareEntryId);
    this.hub.publish(ctx.conversationId, {
      type: cancelled ? SseType.THOUGHT_PREPARE_STEP_CANCELLED : SseType.THOUGHT_PREPARE_STEP_FAILED,
      chatEntryId: prepareEntryId,
      ...(cancelled ? {} : { error: detail }),
    } as never);
  }
}
