import { Injectable, Logger } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import type { PreparedReason, ThoughtLifecycleEntries, ThoughtReasonLlmResult, ThoughtTypeProvider } from '../types.js';
import { DecisionStep } from './decisionStep.js';

@Injectable()
export class ReasonStep {
  private readonly logger = new Logger(ReasonStep.name);

  constructor(
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly llmProviders: LlmProviderRegistry,
    private readonly decisionStep: DecisionStep,
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  async run<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    lifecycle: ThoughtLifecycleEntries,
    prepared: PreparedReason,
    signal: AbortSignal,
  ): Promise<void> {
    this.hub.publish(lifecycle.conversationId, {
      type: SseType.THOUGHT_REASON_STEP_STARTING,
      chatEntryId: lifecycle.streamEntryId,
    });
    let llmResult: ThoughtReasonLlmResult;
    try {
      signal.throwIfAborted();
      llmResult = await this.streamLlm(provider, input, lifecycle, prepared.prompt, signal);
    } catch (error) {
      await this.markFailed(lifecycle, error, signal);
      throw error;
    }
    void this.decisionStep.run(provider, input, lifecycle, llmResult, signal).catch((error) => {
      this.logger.error(
        `decision step failed for ${lifecycle.thoughtId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async streamLlm<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    lifecycle: ThoughtLifecycleEntries,
    prompt: string,
    signal: AbortSignal,
  ): Promise<ThoughtReasonLlmResult> {
    const llmDoc = await this.llmProviderSettings.getDocument();
    const providerId = llmDoc.llm_configuration.provider_id;
    const modelName = llmDoc.llm_configuration.model_name;
    const llmProvider = this.llmProviders.get(providerId);
    if (!llmProvider) throw new Error(`unknown llm provider: ${providerId}`);
    const providerSettings = await this.llmProviderSettings.getProviderSettings(providerId);
    if (!providerSettings) throw new Error(`llm provider settings not found: ${providerId}`);

    const startedAt = Date.now();
    let streamedText = '';
    const completion = await llmProvider.streamTextCompletion(
      providerSettings,
      { model: modelName, prompt },
      (delta) => {
        signal.throwIfAborted();
        streamedText += delta;
        provider.onLlmDelta?.(input, lifecycle, delta);
      },
    );
    signal.throwIfAborted();

    const fullResponse = String(completion.text || streamedText);
    const result: ThoughtReasonLlmResult = { fullResponse, providerId, model: modelName };
    if (completion.usage) result.usage = completion.usage;

    await this.chatEntries.mergeEntryPayload(lifecycle.conversationId, lifecycle.streamEntryId, {
      status: 'completed',
      llmResponse: fullResponse,
      thoughtMs: Date.now() - startedAt,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.streamEntryId);
    this.hub.publish(lifecycle.conversationId, {
      type: SseType.THOUGHT_REASON_STEP_FINISHED,
      chatEntryId: lifecycle.streamEntryId,
    });
    return result;
  }

  private async markFailed(lifecycle: ThoughtLifecycleEntries, error: unknown, signal: AbortSignal): Promise<void> {
    const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const detail = error instanceof Error ? error.message : String(error);
    const patch: Record<string, unknown> = { status: cancelled ? 'cancelled' : 'failed' };
    if (!cancelled) patch.error = detail;
    await this.chatEntries.mergeEntryPayload(lifecycle.conversationId, lifecycle.streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, lifecycle.conversationId, lifecycle.streamEntryId);
    this.hub.publish(lifecycle.conversationId, {
      type: cancelled ? SseType.THOUGHT_REASON_STEP_CANCELLED : SseType.THOUGHT_REASON_STEP_FAILED,
      chatEntryId: lifecycle.streamEntryId,
      ...(cancelled ? {} : { error: detail }),
    } as never);
  }
}
