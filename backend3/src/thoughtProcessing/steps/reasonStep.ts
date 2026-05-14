import { Injectable, Logger } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { getCompletionText } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmStreamEvent } from '../../llmProviders/types.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import type { ThoughtContext, ThoughtTypeProvider } from '../types.js';
import type { PreparedReason } from './prepareStep.js';

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
  ): Promise<LlmCompletion> {
    scope.throwIfAborted();
    const streamEntryId = ctx.streamEntryId ?? (await this.createStreamEntry(provider, ctx, prepared.display));
    ctx.streamEntryId = streamEntryId;

    if (provider.wantsAction && !ctx.thoughtActionEntryId) {
      ctx.thoughtActionEntryId = await this.createActionEntry(provider, ctx);
    }

    try {
      scope.throwIfAborted();
      return await this.streamLlm(provider, input, ctx, prepared, streamEntryId, scope);
    } catch (error) {
      await this.markFailed(ctx, streamEntryId, error, scope);
      throw error;
    }
  }

  private async createStreamEntry<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    ctx: ThoughtContext,
    requestDisplay: string,
  ): Promise<string> {
    const created = await ctx.chain.append((parentId) =>
      this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
        type: provider.streamEntryType,
        thoughtId: ctx.thoughtId,
        parentId,
        status: 'running',
        llmProviderId: ctx.llmProviderId,
        llmModel: ctx.llmModel,
      }),
    );
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, { llmRequest: requestDisplay });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async createActionEntry<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    ctx: ThoughtContext,
  ): Promise<string> {
    const created = await ctx.chain.append((parentId) =>
      this.chatEntries.appendThoughtActionEntry(ctx.conversationId, {
        thoughtId: ctx.thoughtId,
        parentId,
        status: 'running',
        summary: provider.initialActionSummary ?? 'Waiting for LLM output',
      }),
    );
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async streamLlm<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    ctx: ThoughtContext,
    prepared: PreparedReason,
    streamEntryId: string,
    scope: LifecycleScope,
  ): Promise<LlmCompletion> {
    const llmProvider = this.llmProviders.get(ctx.llmProviderId);
    if (!llmProvider) throw new Error(`unknown llm provider: ${ctx.llmProviderId}`);
    const providerSettings = await this.llmProviderSettings.getProviderSettings(ctx.llmProviderId);
    if (!providerSettings) throw new Error(`llm provider settings not found: ${ctx.llmProviderId}`);

    this.logger.log(
      `[reason-step] streamEntry=${streamEntryId} model=${ctx.llmModel} turns=${prepared.request.messages.length} tools=${prepared.request.tools?.length ?? 0}`,
    );

    const startedAt = Date.now();
    const onEvent = (event: LlmStreamEvent) => {
      scope.throwIfAborted();
      provider.onLlmEvent?.(input, ctx, event);
    };

    const completion = await llmProvider.streamCompletion(providerSettings, ctx.llmModel, prepared.request, onEvent);
    scope.throwIfAborted();

    const responseText = getCompletionText(completion);
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, streamEntryId, {
      status: 'completed',
      llmResponse: responseText,
      thoughtMs: Date.now() - startedAt,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, streamEntryId);
    return completion;
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
