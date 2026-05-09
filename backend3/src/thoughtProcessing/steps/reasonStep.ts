import { Injectable } from '@nestjs/common';
import { SseType } from '../../contracts/sse.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import type {
  DecisionStepInput,
  ReasonStepInput,
  ThoughtReasonLlmRequest,
  ThoughtReasonLlmResult,
  ThoughtTypeProvider,
} from '../types.js';
import { DecisionStep } from './decisionStep.js';

@Injectable()
export class ReasonStep {
  constructor(
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly llmProviders: LlmProviderRegistry,
    private readonly decisionStep: DecisionStep,
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  async run(
    provider: ThoughtTypeProvider<any, any, any, any>,
    input: ReasonStepInput,
    signal: AbortSignal,
  ): Promise<void> {
    const { conversationId, streamEntryId } = input.thought;
    this.hub.publish(conversationId, {
      type: SseType.THOUGHT_REASON_STEP_STARTING,
      chatEntryId: streamEntryId,
    });
    try {
      signal.throwIfAborted();
      const decisionInput = await provider.runReason('reason', input);
      const startedAt = Date.now();
      const runtimeResult = await this.executeRuntime(provider, decisionInput, signal);
      signal.throwIfAborted();
      const thoughtMs = Date.now() - startedAt;
      const nextInput =
        runtimeResult && provider.applyReasonLlmResult
          ? provider.applyReasonLlmResult(decisionInput, runtimeResult)
          : decisionInput;
      await this.chatEntries.mergeEntryPayload(conversationId, streamEntryId, {
        status: 'completed',
        llmResponse: runtimeResult?.fullResponse ?? '',
        thoughtMs,
      });
      await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, streamEntryId);
      this.hub.publish(conversationId, {
        type: SseType.THOUGHT_REASON_STEP_FINISHED,
        chatEntryId: streamEntryId,
        preparedDecisionStepInput: {},
      });
      signal.throwIfAborted();
      await this.decisionStep.run(provider, nextInput, signal);
    } catch (error) {
      const cancelled = signal.aborted || (error instanceof Error && error.name === 'AbortError');
      const detail = error instanceof Error ? error.message : String(error);
      const patch: Record<string, unknown> = { status: cancelled ? 'cancelled' : 'failed' };
      if (!cancelled) patch.error = detail;
      await this.chatEntries.mergeEntryPayload(conversationId, streamEntryId, patch);
      await publishChatEntryUpsert(this.hub, this.chatEntries, conversationId, streamEntryId);
      if (cancelled) {
        this.hub.publish(conversationId, {
          type: SseType.THOUGHT_REASON_STEP_CANCELLED,
          chatEntryId: streamEntryId,
        });
      } else {
        this.hub.publish(conversationId, {
          type: SseType.THOUGHT_REASON_STEP_FAILED,
          chatEntryId: streamEntryId,
          error: detail,
        });
      }
      throw error;
    }
  }

  private async executeRuntime(
    provider: ThoughtTypeProvider<any, any, any, any>,
    decisionInput: DecisionStepInput,
    signal: AbortSignal,
  ): Promise<ThoughtReasonLlmResult | null> {
    const request: ThoughtReasonLlmRequest | null = provider.getReasonLlmRequest?.(decisionInput) ?? null;
    if (!request) return null;

    const llmDoc = await this.llmProviderSettings.getDocument();
    const providerId = llmDoc.llm_configuration.provider_id;
    const modelName = llmDoc.llm_configuration.model_name;
    const llmProvider = this.llmProviders.get(providerId);
    if (!llmProvider) throw new Error(`unknown llm provider: ${providerId}`);
    const providerSettings = await this.llmProviderSettings.getProviderSettings(providerId);
    if (!providerSettings) throw new Error(`llm provider settings not found: ${providerId}`);

    let streamedText = '';
    const completion = await llmProvider.streamTextCompletion(
      providerSettings,
      { model: modelName, prompt: request.prompt },
      (delta) => {
        signal.throwIfAborted();
        streamedText += delta;
        provider.onReasonLlmDelta?.(decisionInput, delta);
      },
    );
    signal.throwIfAborted();
    const result: ThoughtReasonLlmResult = {
      fullResponse: String(completion.text || streamedText),
      providerId,
      model: modelName,
    };
    if (completion.usage) result.usage = completion.usage;
    return result;
  }
}
