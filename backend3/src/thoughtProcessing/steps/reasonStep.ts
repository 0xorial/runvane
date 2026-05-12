import { Injectable, Logger } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import type {
  PreparedReason,
  ThoughtContext,
  ThoughtReasonLlmResult,
  ThoughtTypeProvider,
} from '../types.js';

@Injectable()
export class ReasonStep {
  private readonly logger = new Logger(ReasonStep.name);

  constructor(
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly llmProviders: LlmProviderRegistry,
    private readonly hub: SseHubService,
    private readonly chatEntries: ChatEntriesRepo,
  ) {}

  async run<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    ctx: ThoughtContext,
    prepared: PreparedReason,
    scope: LifecycleScope,
  ): Promise<ThoughtReasonLlmResult> {
    scope.throwIfAborted();
    const streamEntryId = ctx.streamEntryId ?? (await this.createStreamEntry(provider, ctx, prepared.prompt));
    ctx.streamEntryId = streamEntryId;

    if (provider.wantsAction && !ctx.thoughtActionEntryId) {
      ctx.thoughtActionEntryId = await this.createActionEntry(provider, ctx);
    }

    try {
      scope.throwIfAborted();
      return await this.streamLlm(provider, input, ctx, prepared.prompt, streamEntryId, scope);
    } catch (error) {
      await this.markFailed(ctx, streamEntryId, error, scope);
      throw error;
    }
  }

  private async createStreamEntry<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    ctx: ThoughtContext,
    prompt: string,
  ): Promise<string> {
    const created = await this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
      type: provider.streamEntryType,
      thoughtId: ctx.thoughtId,
      status: 'running',
      llmProviderId: ctx.llmProviderId,
      llmModel: ctx.llmModel,
    });
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, { llmRequest: prompt });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async createActionEntry<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    ctx: ThoughtContext,
  ): Promise<string> {
    const created = await this.chatEntries.appendThoughtActionEntry(ctx.conversationId, {
      thoughtId: ctx.thoughtId,
      status: 'running',
      summary: provider.initialActionSummary ?? 'Waiting for LLM output',
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async streamLlm<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    ctx: ThoughtContext,
    prompt: string,
    streamEntryId: string,
    scope: LifecycleScope,
  ): Promise<ThoughtReasonLlmResult> {
    const llmDoc = await this.llmProviderSettings.getDocument();
    const providerId = llmDoc.llm_configuration.provider_id;
    const modelName = llmDoc.llm_configuration.model_name;
    const llmProvider = this.llmProviders.get(providerId);
    if (!llmProvider) throw new Error(`unknown llm provider: ${providerId}`);
    const providerSettings = await this.llmProviderSettings.getProviderSettings(providerId);
    if (!providerSettings) throw new Error(`llm provider settings not found: ${providerId}`);

    this.logger.log(
      `[reason-step] streamEntry=${streamEntryId} promptHash=${cheapHash(prompt)} promptLen=${prompt.length} promptHead=${JSON.stringify(prompt.slice(0, 120))}`,
    );

    const startedAt = Date.now();
    let streamedText = '';
    const completion = await llmProvider.streamTextCompletion(
      providerSettings,
      { model: modelName, prompt },
      (delta) => {
        scope.throwIfAborted();
        streamedText += delta;
        provider.onLlmDelta?.(input, ctx, delta);
      },
    );
    scope.throwIfAborted();

    const fullResponse = String(completion.text || streamedText);
    const result: ThoughtReasonLlmResult = { fullResponse, providerId, model: modelName };
    if (completion.usage) result.usage = completion.usage;

    await this.chatEntries.mergeEntryPayload(ctx.conversationId, streamEntryId, {
      status: 'completed',
      llmResponse: fullResponse,
      thoughtMs: Date.now() - startedAt,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, streamEntryId);
    return result;
  }

  private async markFailed(
    ctx: ThoughtContext,
    streamEntryId: string,
    error: unknown,
    scope: LifecycleScope,
  ): Promise<void> {
    const cancelled = scope.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    const detail = error instanceof Error ? error.message : String(error);
    const patch: Record<string, unknown> = { status: cancelled ? 'cancelled' : 'failed' };
    if (!cancelled) patch.error = detail;
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, streamEntryId);
  }
}

function cheapHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
