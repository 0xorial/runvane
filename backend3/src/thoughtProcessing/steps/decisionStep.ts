import { Injectable } from '@nestjs/common';
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
    try {
      await provider.runDecision(input, lifecycle, llmResult, signal);
    } catch (error) {
      await this.markFailed(lifecycle, error, signal);
      throw error;
    }
  }

  private async markFailed(lifecycle: ThoughtLifecycleEntries, error: unknown, signal: AbortSignal): Promise<void> {
    if (signal.aborted || !lifecycle.thoughtActionEntryId) return;
    const detail = error instanceof Error ? error.message : String(error);
    await this.chatEntries.updateThoughtAction(lifecycle.conversationId, lifecycle.thoughtActionEntryId, {
      status: 'failed',
      action: 'failed',
      summary: detail,
      error: detail,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.thoughtActionEntryId);
  }
}
