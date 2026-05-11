import { Injectable } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import type { ThoughtLifecycleEntries, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';

@Injectable()
export class DecisionStep {
  constructor(
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  async run<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    lifecycle: ThoughtLifecycleEntries,
    llmResult: ThoughtReasonLlmResult,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const actionEntryId = lifecycle.thoughtActionEntryId;
    if (actionEntryId) {
      this.hub.publish(lifecycle.conversationId, {
        type: SseType.THOUGHT_DECISION_STEP_STARTING,
        chatEntryId: actionEntryId,
      });
    }
    try {
      await provider.runDecision(input, lifecycle, llmResult, signal);
      if (actionEntryId) {
        this.hub.publish(lifecycle.conversationId, {
          type: SseType.THOUGHT_DECISION_STEP_FINISHED,
          chatEntryId: actionEntryId,
        });
      }
    } catch (error) {
      await this.markFailed(lifecycle, error, signal);
      throw error;
    }
  }

  private async markFailed(lifecycle: ThoughtLifecycleEntries, error: unknown, signal: AbortSignal): Promise<void> {
    const actionEntryId = lifecycle.thoughtActionEntryId;
    if (!actionEntryId) return;
    const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const detail = error instanceof Error ? error.message : String(error);
    if (cancelled) {
      this.hub.publish(lifecycle.conversationId, {
        type: SseType.THOUGHT_DECISION_STEP_CANCELLED,
        chatEntryId: actionEntryId,
      });
      return;
    }
    await this.chatEntries.updateThoughtAction(lifecycle.conversationId, actionEntryId, {
      status: 'failed',
      action: 'failed',
      summary: detail,
      error: detail,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, actionEntryId);
    this.hub.publish(lifecycle.conversationId, {
      type: SseType.THOUGHT_DECISION_STEP_FAILED,
      chatEntryId: actionEntryId,
      error: detail,
    });
  }
}
