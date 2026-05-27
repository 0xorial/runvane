import { Injectable, Logger } from '@nestjs/common';
import { LifecycleScope } from '../../conversations/lifecycle-scope.js';
import { ChatEntriesRepo } from '../../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../../db/repositories/llm-provider-settings.repo.js';
import { LlmProviderRegistry } from '../../llmProviders/registry.js';
import { expandAttachmentRefs } from '../../llmProviders/expandAttachments.js';
import { getCompletionText, getCompletionThinking } from '../../llmProviders/types.js';
import type { LlmCompletion, LlmStreamEvent } from '../../llmProviders/types.js';
import { SseHubService } from '../../sse/sse-hub.service.js';
import { publishChatEntryUpsert } from '../../sse/sse-helpers.js';
import { TaskRegistryService } from '../../tasks/task-registry.service.js';
import { UploadsService } from '../../uploads/uploads.service.js';
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
    private readonly uploads: UploadsService,
    private readonly taskRegistry: TaskRegistryService,
  ) {}

  async run<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    input: TInput,
    ctx: ThoughtContext,
    prepared: PreparedReason,
    scope: LifecycleScope,
  ): Promise<LlmCompletion> {
    scope.throwIfAborted();
    const streamEntryId = ctx.streamEntryId ?? (await this.createStreamEntry(provider, ctx, input, prepared.display));
    ctx.streamEntryId = streamEntryId;

    if (!ctx.thoughtActionEntryId) {
      ctx.thoughtActionEntryId = await this.createActionEntry(provider, ctx);
    }

    return this.taskRegistry.run(
      {
        kind: 'llm',
        title: `${provider.streamEntryType} · ${ctx.llm.model}`,
        conversationId: ctx.conversationId,
        parentSignal: scope.signal,
      },
      async (taskSignal) => {
        const onAbort = () => {
          void this.setStreamStatus(ctx, streamEntryId, 'cancelled');
        };
        taskSignal.addEventListener('abort', onAbort, { once: true });
        try {
          taskSignal.throwIfAborted();
          return await this.streamLlm(provider, input, ctx, prepared, streamEntryId, taskSignal);
        } catch (error) {
          if (taskSignal.aborted) throw error;
          const detail = error instanceof Error ? error.message : String(error);
          await this.setStreamStatus(ctx, streamEntryId, 'failed', detail);
          throw error;
        } finally {
          taskSignal.removeEventListener('abort', onAbort);
        }
      },
    );
  }

  private async createStreamEntry<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    ctx: ThoughtContext,
    input: TInput,
    requestDisplay: string,
  ): Promise<string> {
    const created = await ctx.chain.append(ctx.thoughtId, (parentId) =>
      this.chatEntries.appendThoughtStreamEntry(ctx.conversationId, {
        type: provider.streamEntryType,
        thoughtId: ctx.thoughtId,
        parentId,
        status: 'running',
        llm: ctx.llm,
      }),
    );
    const extra = provider.streamEntryExtraPayload?.(input);
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, created.id, {
      llmRequest: requestDisplay,
      ...(extra ?? {}),
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, created.id);
    return created.id;
  }

  private async createActionEntry<TInput>(
    provider: ThoughtTypeProvider<TInput>,
    ctx: ThoughtContext,
  ): Promise<string> {
    const created = await ctx.chain.append(ctx.thoughtId, (parentId) =>
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
    signal: AbortSignal,
  ): Promise<LlmCompletion> {
    const llmProvider = this.llmProviders.get(ctx.llm.providerId);
    if (!llmProvider) throw new Error(`unknown llm provider: ${ctx.llm.providerId}`);
    const providerSettings = await this.llmProviderSettings.getProviderSettings(ctx.llm.providerId);
    if (!providerSettings) throw new Error(`llm provider settings not found: ${ctx.llm.providerId}`);

    const wireRequest = await expandAttachmentRefs(prepared.request, async (id) => {
      const content = await this.uploads.readContentById(id);
      if (!content) return null;
      return {
        filename: content.attachment.name,
        mime: content.attachment.mimeType || 'application/octet-stream',
        bytes: content.data,
      };
    });

    this.logger.log(
      `llm → ${ctx.llm.providerId}/${ctx.llm.model} turns=${wireRequest.messages.length} tools=${wireRequest.tools?.length ?? 0}`,
    );

    const startedAt = Date.now();
    const onEvent = (event: LlmStreamEvent) => {
      signal.throwIfAborted();
      provider.onLlmEvent?.(input, ctx, event);
    };

    const completion = await llmProvider.streamCompletion(
      providerSettings,
      ctx.llm.model,
      wireRequest,
      onEvent,
      signal,
    );
    signal.throwIfAborted();

    const elapsedMs = Date.now() - startedAt;
    const usage = completion.usage;
    const usageStr = usage
      ? `prompt=${usage.promptTokens} cached=${usage.cachedPromptTokens ?? 0} completion=${usage.completionTokens}`
      : 'usage=unknown';
    this.logger.log(
      `llm ← ${ctx.llm.providerId}/${ctx.llm.model} ${elapsedMs}ms finish=${completion.finishReason} ${usageStr}`,
    );

    const responseText = getCompletionText(completion);
    const thinkingText = getCompletionThinking(completion);
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, streamEntryId, {
      status: 'completed',
      llmResponse: responseText,
      ...(thinkingText ? { thinkingText } : {}),
      thoughtMs: Date.now() - startedAt,
    });
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, streamEntryId);
    return completion;
  }

  private async setStreamStatus(
    ctx: ThoughtContext,
    streamEntryId: string,
    status: 'failed' | 'cancelled',
    errorDetail?: string,
  ): Promise<void> {
    const patch: Record<string, unknown> = { status };
    if (errorDetail) patch.error = errorDetail;
    await this.chatEntries.mergeEntryPayload(ctx.conversationId, streamEntryId, patch);
    await publishChatEntryUpsert(this.hub, this.chatEntries, ctx.conversationId, streamEntryId);
  }
}
