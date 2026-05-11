import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import type { ThoughtLifecycleEntries, ThoughtTypeProvider } from '../types.js';
import { ReasonStep } from './reasonStep.js';

@Injectable()
export class PrepareStep {
  private readonly logger = new Logger(PrepareStep.name);

  constructor(
    private readonly reasonStep: ReasonStep,
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  async run<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    lifecycle: ThoughtLifecycleEntries,
    signal: AbortSignal,
  ): Promise<void> {
    const { conversationId, prepareEntryId, thoughtId } = lifecycle;
    this.hub.publish(conversationId, {
      type: SseType.THOUGHT_PREPARE_STEP_STARTING,
      chatEntryId: prepareEntryId,
      thoughtId,
    });
    let prepared;
    try {
      signal.throwIfAborted();
      prepared = provider.runPrepare(input);
      const preparedReasonStepInput = { requestText: prepared.prompt };
      await this.chatEntries.mergeEntryPayload(conversationId, prepareEntryId, {
        status: 'completed',
        preparedReasonStepInput,
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, prepareEntryId);
      this.hub.publish(conversationId, {
        type: SseType.THOUGHT_PREPARE_STEP_FINISHED,
        chatEntryId: prepareEntryId,
        preparedReasonStepInput,
      });
    } catch (error) {
      await this.markFailed(lifecycle, error, signal);
      throw error;
    }
    void this.reasonStep.run(provider, input, lifecycle, prepared, signal).catch((error) => {
      this.logger.error(
        `reason step failed for ${thoughtId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async markFailed(lifecycle: ThoughtLifecycleEntries, error: unknown, signal: AbortSignal): Promise<void> {
    const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const detail = error instanceof Error ? error.message : String(error);
    const patch: Record<string, unknown> = { status: cancelled ? 'cancelled' : 'failed' };
    if (!cancelled) patch.error = detail;
    await this.chatEntries.mergeEntryPayload(lifecycle.conversationId, lifecycle.prepareEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.prepareEntryId);
    this.hub.publish(lifecycle.conversationId, {
      type: cancelled ? SseType.THOUGHT_PREPARE_STEP_CANCELLED : SseType.THOUGHT_PREPARE_STEP_FAILED,
      chatEntryId: lifecycle.prepareEntryId,
      ...(cancelled ? {} : { error: detail }),
    } as never);
  }
}
