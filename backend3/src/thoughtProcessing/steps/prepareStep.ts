import { Injectable } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import type { PrepareStepInput, ThoughtTypeProvider } from '../types.js';
import { ReasonStep } from './reasonStep.js';

@Injectable()
export class PrepareStep {
  constructor(
    private readonly reasonStep: ReasonStep,
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  async run(
    provider: ThoughtTypeProvider<any, any, any, any>,
    input: PrepareStepInput,
    signal: AbortSignal,
  ): Promise<void> {
    const { conversationId, prepareEntryId, thoughtId } = input.thought;
    this.hub.publish(conversationId, {
      type: SseType.THOUGHT_PREPARE_STEP_STARTING,
      chatEntryId: prepareEntryId,
      thoughtId,
    });
    try {
      signal.throwIfAborted();
      const reasonInput = await provider.runPrepare('prepare', input);
      const preparedReasonStepInput = provider.getPreparedReasonInfo
        ? provider.getPreparedReasonInfo(reasonInput)
        : { requestText: '' };
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
      signal.throwIfAborted();
      await this.reasonStep.run(provider, reasonInput, signal);
    } catch (error) {
      const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError');
      const detail = error instanceof Error ? error.message : String(error);
      const patch: Record<string, unknown> = { status: cancelled ? 'cancelled' : 'failed' };
      if (!cancelled) patch.error = detail;
      await this.chatEntries.mergeEntryPayload(conversationId, prepareEntryId, patch);
      await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, prepareEntryId);
      if (cancelled) {
        this.hub.publish(conversationId, {
          type: SseType.THOUGHT_PREPARE_STEP_CANCELLED,
          chatEntryId: prepareEntryId,
        });
      } else {
        this.hub.publish(conversationId, {
          type: SseType.THOUGHT_PREPARE_STEP_FAILED,
          chatEntryId: prepareEntryId,
          error: detail,
        });
      }
      throw error;
    }
  }
}
